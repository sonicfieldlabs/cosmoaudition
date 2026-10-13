"""Optional offline ecCodes decoder. Never installs dependencies or fetches sources.

Produces the application-owned local observation envelope. Input licence/rights
are operator declarations; ecCodes decoding establishes neither permission nor
weather truth. GRIB forecast validity is distinct from its issue time.
"""

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def decode(
    path, *, source_id, attribution, license_note, rights_ref, coverage, fetched_at
):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 32 * 1024**2:
        raise ValueError("GRIB input must be regular and within 32 MiB")
    # Import only on explicit decoding. No model/runtime provisioning is performed.
    import eccodes as ec

    with path.open("rb") as source:
        raw = source.read(32 * 1024**2 + 1)
    if len(raw) > 32 * 1024**2:
        raise ValueError("GRIB byte budget exceeded")
    points, issue_times = [], []

    # ecCodes needs an actual file descriptor; freeze admitted bytes locally.
    import tempfile

    with tempfile.TemporaryFile() as frozen:
        frozen.write(raw)
        frozen.seek(0)
        for message in range(17):
            handle = ec.codes_grib_new_from_file(frozen)
            if handle is None:
                break
            try:
                count = int(ec.codes_get(handle, "numberOfPoints"))
                if message == 16 or count < 1 or len(points) + count > 4096:
                    raise ValueError("GRIB message or grid-point budget exceeded")

                def stamp(date_key, time_key, handle=handle):
                    text = f"{int(ec.codes_get(handle, date_key)):08d}{int(ec.codes_get(handle, time_key)):04d}"
                    return (
                        datetime.strptime(text, "%Y%m%d%H%M")
                        .replace(tzinfo=timezone.utc)
                        .isoformat()
                    )

                issue_times.append(stamp("dataDate", "dataTime"))
                valid = stamp("validityDate", "validityTime")
                name, unit = (
                    str(ec.codes_get(handle, "shortName")),
                    str(ec.codes_get(handle, "units")),
                )
                missing = ec.codes_get(handle, "missingValue")
                latitudes = ec.codes_get_array(handle, "latitudes")
                longitudes = ec.codes_get_array(handle, "longitudes")
                for index, value in enumerate(ec.codes_get_values(handle)):
                    value = float(value)
                    if not math.isfinite(float(latitudes[index])) or not math.isfinite(
                        float(longitudes[index])
                    ):
                        raise ValueError("GRIB coordinate is not finite")
                    points.append(
                        dict(
                            id=f"{name}.{message}.{index}.lat{float(latitudes[index]):.5f}.lon{float(longitudes[index]):.5f}",
                            unit=unit,
                            validAt=valid,
                            value=None
                            if value == missing or not math.isfinite(value)
                            else value,
                        )
                    )
            finally:
                ec.codes_release(handle)
    if not points or len(set(issue_times)) != 1:
        raise ValueError("GRIB import requires nonempty fields with one issue time")
    return dict(
        contract="cosmo/local-observation/v1",
        sourceId=source_id,
        kind="grib-forecast",
        sourceSha256=hashlib.sha256(raw).hexdigest(),
        accountRef=None,
        attribution=attribution,
        license=license_note,
        rightsRef=rights_ref,
        coverage=coverage,
        issuedAt=issue_times[0],
        fetchedAt=fetched_at,
        ttlSeconds=3600,
        points=points,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    for key in (
        "source-id",
        "attribution",
        "license-note",
        "rights-ref",
        "coverage",
        "fetched-at",
    ):
        parser.add_argument("--" + key, required=True)
    args = vars(parser.parse_args())
    if os.environ.get("COSMO_GRIB_WORKER") == "1":
        print(json.dumps(decode(**args), allow_nan=False))
    else:
        # Native codec work stays outside the API, in a bounded one-shot process.
        with tempfile.TemporaryFile() as output:
            run = subprocess.run(
                [sys.executable, __file__, *sys.argv[1:]],
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=False,
                env={
                    k: v
                    for k, v in os.environ.items()
                    if k in {"PATH", "HOME", "TMPDIR"}
                }
                | {"COSMO_GRIB_WORKER": "1", "PYTHONDONTWRITEBYTECODE": "1"},
            )
            if run.returncode:
                raise ValueError("GRIB decoder refused input; no import produced")
            output.seek(0)
            raw = output.read(2 * 1024**2 + 1)
            if len(raw) > 2 * 1024**2:
                raise ValueError("GRIB normalized output exceeds 2 MiB")
            sys.stdout.write(raw.decode())
