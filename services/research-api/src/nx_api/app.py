import csv
import io
import os
import secrets
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from nx_loop import LoopEngine, generate
from nx_schema import (
    Benchmark,
    CorrectionInput,
    EdgeInput,
    EntityInput,
    Kind,
    Relation,
    ReviewInput,
    RunInput,
    StrictModel,
)
from nx_trace import TraceStore
from nx_trace.db import Edge, Layout, Record
from nx_trace.exchange import ProvenanceBundle, export_bundle, import_bundle
from nx_trace.store import serialize
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.middleware.trustedhost import TrustedHostMiddleware


class ProjectInput(StrictModel):
    label: str = Field(min_length=1, max_length=200)
    actor: str = Field(default="Local researcher", min_length=1, max_length=100)


class FixtureInput(StrictModel):
    seed: int = 20261102
    per_family: int = Field(default=20, ge=2, le=100)
    actor: str = Field(default="Local researcher", min_length=1, max_length=100)


class VersionInput(StrictModel):
    record: EntityInput
    expected_version: int = Field(ge=1)


class LayoutInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    view: Literal["overview", "evaluations", "evidence", "datasets", "reviews"] = "overview"
    inspector_width: int = Field(default=360, ge=260, le=560)
    run_id: str | None = None
    family: str = "all"


class RerunInput(StrictModel):
    scope: Literal["affected", "full"] = "affected"
    actor: str = Field(default="Local researcher", min_length=1, max_length=100)


def create_app(trace=None, static_dir=None, reader_token=None, writer_token=None):
    trace = trace or TraceStore(
        os.environ.get("NX_DATABASE_URL", "sqlite:///research-stack.sqlite"),
        initialize=True,
    )
    loop = LoopEngine(trace)
    app = FastAPI(
        title="Nurowerx Research Stack",
        version="0.1.1",
        description="TRACE provenance and LOOP evaluation API. Baseline results are synthetic policy measurements.",
    )
    app.state.trace = trace
    app.state.loop = loop
    hosts = os.environ.get("NX_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]").split(",")
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[h.strip() for h in hosts],
        www_redirect=False,
    )
    reader_token = reader_token or os.environ.get("NX_READER_TOKEN")
    writer_token = writer_token or os.environ.get("NX_WRITER_TOKEN")
    if reader_token and not writer_token:
        raise ValueError("Configure NX_WRITER_TOKEN together with NX_READER_TOKEN")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.url.path != "/api/health":
            write = request.method not in ("GET", "HEAD", "OPTIONS")
            origin = request.headers.get("origin")
            allowed = {
                str(request.base_url).rstrip("/"),
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            }
            if write and origin and origin not in allowed:
                return JSONResponse({"detail": "Untrusted request origin"}, 403)
            if (
                write
                and request.headers.get("content-type", "").split(";")[0] != "application/json"
            ):
                return JSONResponse({"detail": "Use application/json"}, 415)
            if writer_token:
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                permitted = (
                    [writer_token] if write else [writer_token, reader_token or writer_token]
                )
                if not any(secrets.compare_digest(token, t) for t in permitted):
                    return JSONResponse(
                        {
                            "detail": "A writer token is required"
                            if write
                            else "A reader or writer token is required"
                        },
                        401,
                    )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return JSONResponse({"detail": str(exc).strip("'")}, 404)

    @app.exception_handler(ValueError)
    async def invalid(_, exc):
        return JSONResponse({"detail": str(exc)}, 422)

    @app.exception_handler(IntegrityError)
    async def conflict(_, exc):
        return JSONResponse(
            {
                "detail": "Immutable record or conflicting version. Reload and create a new revision."
            },
            409,
        )

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "version": "0.1.1",
            "mode": "token access" if writer_token else "trusted local workspace",
            "synthetic_baseline": True,
        }

    @app.get("/api/ontology")
    def ontology():
        return {
            "kinds": list(Kind),
            "relations": list(Relation),
            "assessments": [
                "citation_only",
                "fixture_oracle",
                "human_judgment",
                "structural",
            ],
        }

    @app.get("/api/projects")
    def projects():
        return trace.records(kind=Kind.PROJECT, limit=1000)

    @app.post("/api/projects", status_code=201)
    def project(body: ProjectInput):
        return trace.project(body.label, body.actor)

    @app.get("/api/projects/{pid}/records")
    def records(pid: str, kind: Kind | None = None, limit: int = Query(300, ge=1, le=10000)):
        rows = trace.records(pid, kind, limit)
        for row in rows:
            if "external_export" in row["payload"]:
                row["payload"] = {k: v for k, v in row["payload"].items() if k != "external_export"}
                row["payload"]["detail_note"] = (
                    "Full external export is available on the individual record endpoint."
                )
        return rows

    @app.post("/api/projects/{pid}/records", status_code=201)
    def record(pid: str, body: EntityInput):
        return trace.create(pid, body)

    @app.get("/api/records/{rid}")
    def record_detail(rid: str):
        return trace.get(rid)

    @app.post("/api/records/{rid}/versions", status_code=201)
    def version(rid: str, body: VersionInput):
        return trace.version(rid, body.record, body.expected_version)

    @app.get("/api/records/{rid}/claim-state")
    def claim_state(rid: str):
        return trace.claim_state(rid)

    @app.post("/api/edges", status_code=201)
    def edge(body: EdgeInput):
        return trace.edge(body)

    @app.get("/api/projects/{pid}/graph")
    def graph(
        pid: str,
        root: str | None = None,
        depth: int = Query(2, ge=0, le=5),
        relation: Relation | None = None,
        limit: int = Query(160, ge=1, le=500),
    ):
        return trace.graph(pid, root, depth, relation, limit)

    @app.get("/api/projects/{pid}/integrity")
    def integrity(pid: str):
        return trace.verify(pid)

    @app.get("/api/projects/{pid}/export")
    def export_project(pid: str):
        trace.get(pid)
        with trace.sessions() as db:
            return {
                "schema_version": "1.0",
                "records": [
                    serialize(r) for r in db.scalars(select(Record).where(Record.project_id == pid))
                ],
                "edges": [
                    serialize(e) for e in db.scalars(select(Edge).where(Edge.project_id == pid))
                ],
                "integrity": trace.verify(pid),
            }

    @app.get("/api/projects/{pid}/bundle")
    def bundle(pid: str):
        return export_bundle(trace, pid)

    @app.post("/api/import/provenance", status_code=201)
    def ingest_bundle(body: ProvenanceBundle):
        return import_bundle(trace, body.model_dump(mode="json"))

    @app.post("/api/projects/{pid}/fixtures", status_code=201)
    def fixture(pid: str, body: FixtureInput):
        trace.get(pid)
        return loop.register_benchmark(pid, generate(body.seed, body.per_family), body.actor)

    @app.post("/api/projects/{pid}/benchmarks", status_code=201)
    def register(pid: str, body: Benchmark):
        trace.get(pid)
        return loop.register_benchmark(pid, body)

    @app.get("/api/benchmarks/{bid}")
    def benchmark(bid: str):
        record, data = loop.benchmark(bid)
        return {"record": record, "benchmark": data.model_dump()}

    @app.get("/api/targets")
    def targets():
        return loop.registry.describe()

    @app.get("/api/projects/{pid}/runs")
    def runs(pid: str):
        return loop.runs(pid)

    @app.post("/api/runs", status_code=201)
    def execute(body: RunInput):
        return loop.execute(body)

    @app.get("/api/runs/{rid}")
    def run(rid: str):
        return loop.run_detail(rid)

    @app.get("/api/compare")
    def compare(before: str, after: str):
        return loop.compare(before, after)

    @app.get("/api/runs/{rid}/report")
    def report(rid: str):
        return JSONResponse(
            loop.report(rid),
            headers={"Content-Disposition": f'attachment; filename="report-{rid[:8]}.json"'},
        )

    @app.get("/api/runs/{rid}/results.csv")
    def results_csv(rid: str):
        data = loop.run_detail(rid)
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(
            [
                "case_id",
                "repeat",
                "family",
                "answer",
                "correct",
                "error",
                "latency_ms",
                "output_id",
                "claim_id",
            ]
        )

        def safe(value):
            text = "" if value is None else str(value)
            return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r")) else text

        for r in data["results"]:
            writer.writerow(
                [
                    safe(v)
                    for v in (
                        r["case_id"],
                        r["repeat"],
                        r["family"],
                        r["prediction"]["answer"],
                        r["scores"]["correct"],
                        r["scores"]["error"],
                        r["latency_ms"],
                        r["output_id"],
                        r["claim_id"],
                    )
                ]
            )
        return Response(
            stream.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="results.csv"'},
        )

    @app.post("/api/corrections", status_code=201)
    def propose(body: CorrectionInput):
        return loop.propose(body)

    @app.get("/api/projects/{pid}/corrections")
    def corrections(pid: str):
        return [loop.correction_state(r["id"]) for r in trace.records(pid, Kind.CORRECTION, 1000)]

    @app.get("/api/corrections/{cid}")
    def correction(cid: str):
        return loop.correction_state(cid)

    @app.post("/api/corrections/{cid}/reviews", status_code=201)
    def review(cid: str, body: ReviewInput):
        return loop.review(cid, body)

    @app.post("/api/corrections/{cid}/rerun", status_code=201)
    def rerun(cid: str, body: RerunInput):
        correction = loop.correction_state(cid)
        parent = loop.run_detail(correction["payload"]["run_id"])
        config = trace.get(parent["config_id"])["payload"]
        return loop.execute(
            RunInput(
                benchmark_id=parent["benchmark_id"],
                target=parent["target"],
                split=parent["split"],
                repeats=parent["request"]["repeats"],
                parameters=config["parameters"],
                case_ids=[correction["payload"]["case_id"]] if body.scope == "affected" else [],
                correction_ids=list(dict.fromkeys([*config["correction_ids"], cid])),
                parent_run_id=parent["id"],
                actor=body.actor,
            )
        )

    @app.get("/api/projects/{pid}/layouts")
    def layouts(pid: str):
        with trace.sessions() as db:
            return [
                serialize(x)
                for x in db.scalars(
                    select(Layout).where(Layout.project_id == pid).order_by(Layout.created.desc())
                )
            ]

    @app.post("/api/projects/{pid}/layouts", status_code=201)
    def save_layout(pid: str, body: LayoutInput):
        trace.get(pid)
        if body.run_id and loop.run_detail(body.run_id)["project_id"] != pid:
            raise ValueError("Run belongs to another project")
        with trace.sessions.begin() as db:
            row = Layout(
                id=str(uuid4()),
                project_id=pid,
                name=body.name,
                configuration=body.model_dump(exclude={"name"}),
                created=time.time(),
            )
            db.add(row)
            db.flush()
            return serialize(row)

    static = Path(static_dir or os.environ.get("NX_STATIC_DIR", "apps/research-console/dist"))
    if static.is_dir():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/")
        def index():
            return FileResponse(static / "index.html")

    return app
