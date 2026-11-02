"""Append validated upstream draws without dropping or replacing local history."""
from __future__ import annotations

import argparse
import ast
import csv
import datetime as dt
import io
from pathlib import Path
import urllib.request

FIELDS = ["draw_number", "number", "date"]
UPSTREAM = "https://raw.githubusercontent.com/playingmeow/SingaporePools/main/toto_prizes.csv"


def read_rows(content: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    if reader.fieldnames != FIELDS:
        raise ValueError("Unexpected CSV columns; keeping previous file")
    rows = list(reader)
    ids = [int(row["draw_number"]) for row in rows]
    if any(number < 1 for number in ids) or len(set(ids)) != len(ids):
        raise ValueError("Invalid or duplicate draw IDs; keeping previous file")
    return rows


def valid_incoming(row: dict[str, str]) -> bool:
    try:
        day = dt.datetime.strptime(row["date"], "%Y/%m/%d").date()
        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
        numbers = ast.literal_eval(row["number"])
        return (
            day.strftime("%Y/%m/%d") == row["date"]
            and day <= today
            and isinstance(numbers, list)
            and len(numbers) == 7
            and all(isinstance(n, (int, str)) and str(n).isdigit() for n in numbers)
            and all(1 <= int(n) <= 49 for n in numbers)
            and len({int(n) for n in numbers}) == 7
        )
    except (ValueError, TypeError, SyntaxError, KeyError):
        return False


def merge_history(existing: list[dict[str, str]], incoming: list[dict[str, str]]):
    by_id = {int(row["draw_number"]): row for row in existing}
    if len(by_id) != len(existing):
        raise ValueError("Duplicate local IDs; refusing to discard any row")
    added = conflicts = ignored = 0
    for row in incoming:
        if not valid_incoming(row):
            ignored += 1
            continue
        draw_id = int(row["draw_number"])
        if draw_id in by_id:
            if by_id[draw_id] != row:
                conflicts += 1
            continue
        by_id[draw_id] = row
        added += 1
    return [by_id[key] for key in sorted(by_id)], {"added": added, "conflicts_kept_local": conflicts, "invalid_ignored": ignored}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, default=Path("toto_prizes.csv"))
    args = parser.parse_args()
    existing = read_rows(args.path.read_text(encoding="utf-8-sig"))
    request = urllib.request.Request(UPSTREAM, headers={"User-Agent": "GG-Supreme-TOTO/12"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    incoming = read_rows(data.decode("utf-8-sig"))
    if len(data) < 10000 or len(incoming) < 1000:
        raise ValueError("Upstream CSV too small; keeping previous file")
    merged, stats = merge_history(existing, incoming)
    if not stats["added"]:
        print("No new draws; original CSV bytes retained.", stats)
        return
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(merged)
    temporary = args.path.with_suffix(".csv.tmp")
    temporary.write_text(output.getvalue(), encoding="utf-8")
    temporary.replace(args.path)
    print("History retained:", len(existing), "rows; merged:", len(merged), stats)


if __name__ == "__main__":
    main()
