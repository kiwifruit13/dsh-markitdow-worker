#!/usr/bin/env python3
"""apply-vendor-patches.py — 重放 vendored 局部补丁（unified diff），可校验。

为什么不用 GNU `patch`：
    本机（Windows）`patch.exe` 只随 Git Bash 的 MSYS 工具链提供（`/usr/bin/patch.exe`），
    **不在 Windows PATH 上** —— 于是 `pwsh -File scripts/sync-vendor.ps1` 在 PowerShell/cmd
    下必然找不到 `patch`。Python 是本项目的硬依赖（bridge 即 Python），用它可消除该外部依赖。

语义（对齐 `patch -p1 --forward --batch`，但更严格）：
    - 只接受本仓库生成的 git 风格 diff（`--- a/<path>` / `+++ b/<path>`），-p1 剥离 `a/`、`b/`。
    - 每个 hunk 必须能**精确定位**（先按期望行号，再在全文唯一匹配处回退）。
      找不到、或匹配到多处 → 报错，不猜测、不模糊匹配（`patch` 的 fuzz 在这里是风险而非便利）。
    - `--check` 只校验不落盘；任一文件失败即 exit=1。
    - 写盘保持原换行风格（LF/CRLF）与文件末尾换行状态。

用法：
    python apply-vendor-patches.py --root <repoRoot> [--check] <diff> [<diff> ...]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HUNK_HEADER = "@@"


class PatchError(Exception):
    """预镜像不匹配 / diff 结构错误 —— 属 Fail-Closed，绝不静默跳过。"""


def parse_diff(text: str) -> list[tuple[str, list[tuple[int, list[str], list[str]]]]]:
    """解析 unified diff → [(target_relpath, [(old_start, old_block, new_block), ...]), ...]

    old_block = 上下文行 + 被删除行（应与目标文件逐行相等）
    new_block = 上下文行 + 新增行（写回内容）
    """
    lines = text.split("\n")
    files: list[tuple[str, list[tuple[int, list[str], list[str]]]]] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        if not line.startswith("--- "):
            i += 1
            continue

        if i + 1 >= n or not lines[i + 1].startswith("+++ "):
            raise PatchError(f"第 {i + 1} 行：`--- ` 之后缺少 `+++ ` 头")
        new_label = lines[i + 1][4:].strip()
        # -p1：剥掉首个路径分量（git 风格 a/、b/）
        parts = new_label.split("/")
        if len(parts) < 2:
            raise PatchError(f"无法从 `{new_label}` 剥离 -p1 前缀")
        target = "/".join(parts[1:])
        i += 2

        hunks: list[tuple[int, list[str], list[str]]] = []
        while i < n and lines[i].startswith(HUNK_HEADER):
            header = lines[i]
            # @@ -<start>[,<count>] +<start>[,<count>] @@ [尾随上下文]
            try:
                body = header[len(HUNK_HEADER):].split(HUNK_HEADER, 1)[0].strip()
                old_part, new_part = body.split()
                old_start = int(old_part[1:].split(",")[0])
                old_count = int(old_part.split(",")[1]) if "," in old_part else 1
                new_count = int(new_part.split(",")[1]) if "," in new_part else 1
            except (IndexError, ValueError) as exc:
                raise PatchError(f"非法 hunk 头：{header!r}") from exc
            i += 1

            # 按声明行数**精确**消费：靠计数而非前缀猜边界。
            # 否则 diff 末端的换行会在 split("\n") 后产生一个多余空串，
            # 被误当作空上下文行吞进最后一个 hunk。
            old_block: list[str] = []
            new_block: list[str] = []
            seen_old = 0
            seen_new = 0
            while i < n and (seen_old < old_count or seen_new < new_count):
                hl = lines[i]
                if hl.startswith("\\"):  # "\ No newline at end of file"
                    i += 1
                    continue
                if hl.startswith("+"):
                    new_block.append(hl[1:])
                    seen_new += 1
                elif hl.startswith("-"):
                    old_block.append(hl[1:])
                    seen_old += 1
                elif hl.startswith(" ") or hl == "":
                    content = hl[1:] if hl.startswith(" ") else ""
                    old_block.append(content)
                    new_block.append(content)
                    seen_old += 1
                    seen_new += 1
                else:
                    raise PatchError(f"第 {i + 1} 行：hunk 内容非法：{hl!r}")
                i += 1
            if seen_old != old_count or seen_new != new_count:
                raise PatchError(
                    f"hunk 内容不足：声明 old={old_count}/new={new_count}，实得 {seen_old}/{seen_new}"
                )
            hunks.append((old_start, old_block, new_block))

        files.append((target, hunks))

    if not files:
        raise PatchError("diff 中未解析出任何文件段")
    return files


def apply_hunks(path: Path, hunks: list[tuple[int, list[str], list[str]]]) -> tuple[str, list[str]]:
    """在内存中应用 hunks。返回 (新文本, 备注列表)。不落盘。"""
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    nl = "\r\n" if "\r\n" in text else "\n"
    had_trailing = text.endswith(("\n", "\r\n"))

    src = text.splitlines()
    out = list(src)
    offset = 0
    notes: list[str] = []

    for idx, (old_start, old_block, new_block) in enumerate(hunks, start=1):
        if not old_block:
            raise PatchError(f"{path.name}: hunk {idx} 无上下文/删除行，无法定位")
        expected = old_start - 1 + offset
        pos = -1

        if 0 <= expected <= len(out) - len(old_block) and out[expected:expected + len(old_block)] == old_block:
            pos = expected
        else:
            # 回退：全文唯一精确匹配（无 fuzz）
            hits = [
                k for k in range(0, len(out) - len(old_block) + 1)
                if out[k:k + len(old_block)] == old_block
            ]
            if len(hits) == 1:
                pos = hits[0]
                notes.append(f"hunk {idx} 偏移定位（期望行 {old_start}，实际行 {pos + 1}）")
            elif not hits:
                raise PatchError(
                    f"{path.name}: hunk {idx} 预镜像不匹配（diff 基线起始行 {old_start}，"
                    f"含前序偏移后期望第 {expected + 1} 行）——目标文件与 diff 基线不一致"
                )
            else:
                raise PatchError(f"{path.name}: hunk {idx} 上下文出现 {len(hits)} 次，无法唯一确定")

        out[pos:pos + len(old_block)] = new_block
        offset += len(new_block) - len(old_block)

    result = nl.join(out)
    if had_trailing:
        result += nl
    return ("\ufeff" if bom else "") + result, notes


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="重放 vendored 局部补丁（unified diff）")
    ap.add_argument("diffs", nargs="+", help="一个或多个 .diff 文件（按给定顺序处理）")
    ap.add_argument("--root", required=True, help="仓库根（diff 内路径相对它）")
    ap.add_argument("--check", action="store_true", help="只校验，不写入")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"[错误] --root 不是目录：{root}")
        return 2

    failures = 0
    touched = 0

    for diff_arg in args.diffs:
        diff_path = Path(diff_arg).resolve()
        if not diff_path.is_file():
            print(f"[错误] diff 不存在：{diff_path}")
            failures += 1
            continue

        print(f"== {diff_path.name} ({'check' if args.check else 'apply'})")
        files = parse_diff(diff_path.read_text(encoding="utf-8"))

        for rel, hunks in files:
            target = root / rel
            if not target.is_file():
                print(f"   [失败] {rel} —— 目标文件不存在")
                failures += 1
                continue
            try:
                new_text, notes = apply_hunks(target, hunks)
            except PatchError as exc:
                print(f"   [失败] {rel} —— {exc}")
                failures += 1
                continue

            if args.check:
                for note in notes:
                    print(f"   [提示] {rel}: {note}")
                print(f"   [通过] {rel}（{len(hunks)} hunk）")
                touched += 1
                continue

            # 用较稳的写法落盘：先写临时文件再替换，避免半写状态
            tmp = target.with_suffix(target.suffix + ".tmp")
            tmp.write_text(new_text, encoding="utf-8", newline="")
            tmp.replace(target)
            for note in notes:
                print(f"   [提示] {rel}: {note}")
            print(f"   [已应用] {rel}（{len(hunks)} hunk）")
            touched += 1

    verb = "校验通过" if args.check else "已应用"
    if failures:
        print(f"[结果] 失败 {failures} 个文件段；未完成。")
        return 1
    print(f"[结果] {verb} {touched} 个文件段，无失败。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
