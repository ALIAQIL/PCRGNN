"""Verify the pinned public PCL files and their ASCII PCD structure."""

import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.request import urlopen

import numpy as np


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "data" / "pc_rgnn" / "provenance.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_ascii_pcd(path: Path) -> int:
    header = []
    with path.open("rb") as handle:
        for raw_line in handle:
            line = raw_line.decode("ascii").strip()
            header.append(line)
            if line.upper().startswith("DATA"):
                break
        fields = next((line.split()[1:] for line in header if line.upper().startswith("FIELDS")), [])
        data_line = next((line for line in header if line.upper().startswith("DATA")), "")
        if not {"x", "y", "z"}.issubset(fields):
            raise ValueError(f"{path.name}: missing x/y/z fields")
        if data_line.lower() != "data ascii":
            raise ValueError(f"{path.name}: only ASCII PCD is supported")
    values = np.loadtxt(path, comments="#", skiprows=len(header), ndmin=2)
    if values.shape[1] < len(fields):
        raise ValueError(f"{path.name}: malformed point rows")
    xyz = values[:, [fields.index(axis) for axis in ("x", "y", "z")]]
    if not np.isfinite(xyz).all():
        raise ValueError(f"{path.name}: non-finite XYZ value")
    return int(xyz.shape[0])


def main(online: bool = False) -> int:
    manifest = json.loads(MANIFEST.read_text())
    failures = []
    for record in manifest["files"]:
        path = ROOT / "data" / "pc_rgnn" / record["file"]
        try:
            if not path.exists():
                raise FileNotFoundError("missing local file")
            if path.stat().st_size != record["bytes"]:
                raise ValueError(f"byte count {path.stat().st_size} != {record['bytes']}")
            local_hash = sha256(path)
            if local_hash != record["sha256"]:
                raise ValueError(f"SHA-256 {local_hash} != {record['sha256']}")
            point_count = parse_ascii_pcd(path)
            print(f"OK local {record['file']}: {point_count} points, {local_hash}")
            if online:
                with urlopen(record["url"], timeout=30) as response:
                    remote_hash = hashlib.sha256(response.read()).hexdigest()
                if remote_hash != record["sha256"]:
                    raise ValueError(f"remote SHA-256 {remote_hash} != {record['sha256']}")
                print(f"OK remote {record['file']}: pinned URL matches")
        except Exception as exc:  # noqa: BLE001 - report every manifest failure
            failures.append(f"{record['file']}: {exc}")
            print(f"FAIL {failures[-1]}", file=sys.stderr)
    if failures:
        return 1
    print(f"Verified {len(manifest['files'])} pinned PCL files.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true", help="also fetch each pinned URL")
    raise SystemExit(main(parser.parse_args().online))
