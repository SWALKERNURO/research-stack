import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  Workspace,
  EmptyState,
  Status,
  type WorkspaceView,
} from "@nurowerx/frame";
import {
  ChartFrame,
  MetricBars,
  ScatterPlot,
  Histogram,
  TimeSeries,
  ProvenanceGraph,
  download,
} from "@nurowerx/lens";
import { api, exportFile, percent, short, title } from "./api";
import type {
  ResearchRecord,
  Run,
  Result,
  Correction,
  Comparison,
  Graph,
  Benchmark,
  SavedLayout,
  Case,
} from "./types";

const views: {
  id: WorkspaceView;
  label: string;
  icon: typeof Activity;
  system: string;
}[] = [
  {
    id: "overview",
    label: "Research overview",
    icon: LayoutDashboard,
    system: "FRAME",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    icon: FlaskConical,
    system: "LOOP",
  },
  {
    id: "evidence",
    label: "Evidence & lineage",
    icon: GitBranch,
    system: "TRACE",
  },
  { id: "datasets", label: "Datasets", icon: Database, system: "TRACE" },
  {
    id: "reviews",
    label: "Review & correction",
    icon: MessageSquare,
    system: "LOOP",
  },
];
const rules = [
  "prefer_latest",
  "trusted_only",
  "abstain_conflict",
  "abstain_missing",
];
const suggestion: Record<string, string> = {
  revision: "prefer_latest",
  recovery: "prefer_latest",
  distractor: "trusted_only",
  conflict: "abstain_conflict",
  missing: "abstain_missing",
};
function Dialog({
  title: heading,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-label={heading} onCancel={onClose}>
      <div className="dialog-heading">
        <h2>{heading}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <span className="eyebrow">{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
      <span>{note}</span>
    </div>
  );
}

export default function App() {
  const client = useQueryClient();
  const [pid, setPid] = useState("");
  const [view, setView] = useState<WorkspaceView>("overview");
  const [runId, setRunId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [selectedResult, setSelectedResult] = useState<Result | null>(null);
  const [family, setFamily] = useState("all");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [latencyRange, setLatencyRange] = useState<[number, number] | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const [inspector, setInspector] = useState(() => window.innerWidth > 1120);
  const [width, setWidth] = useState(340);
  const [actor, setActor] = useState(
    localStorage.getItem("nx-actor") || "Local researcher",
  );
  const [modal, setModal] = useState<
    "project" | "layout" | "access" | "report" | null
  >(null);
  const [reportPreview, setReportPreview] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [target, setTarget] = useState("first-match");
  const [split, setSplit] = useState("development");
  const [repeats, setRepeats] = useState(2);
  const [benchmarkId, setBenchmarkId] = useState("");
  const [parameters, setParameters] = useState<Record<string, boolean>>({});
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [kind, setKind] = useState("");
  const [relation, setRelation] = useState("");
  const [depth, setDepth] = useState(2);
  const [graphKind, setGraphKind] = useState("");
  const [caseDetail, setCaseDetail] = useState<Case | null>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ResearchRecord[]>("/projects"),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ mode: string }>("/health"),
  });
  const runs = useQuery({
    queryKey: ["runs", pid],
    queryFn: () => api<Run[]>(`/projects/${pid}/runs`),
    enabled: !!pid,
  });
  const datasets = useQuery({
    queryKey: ["datasets", pid],
    queryFn: () =>
      api<ResearchRecord[]>(
        `/projects/${pid}/records?kind=dataset_version&limit=1000`,
      ),
    enabled: !!pid,
  });
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api<Run>(`/runs/${runId}`),
    enabled: !!runId,
  });
  const record = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => api<ResearchRecord>(`/records/${recordId}`),
    enabled: !!recordId,
  });
  const claim = useQuery({
    queryKey: ["claim", recordId],
    queryFn: () =>
      api<{
        status: string;
        incomplete_provenance: boolean;
        basis: string[];
        caveat: string;
      }>(`/records/${recordId}/claim-state`),
    enabled:
      !!recordId && ["claim", "conclusion"].includes(record.data?.kind ?? ""),
  });
  const corrections = useQuery({
    queryKey: ["corrections", pid],
    queryFn: () => api<Correction[]>(`/projects/${pid}/corrections`),
    enabled: !!pid,
  });
  const layouts = useQuery({
    queryKey: ["layouts", pid],
    queryFn: () => api<SavedLayout[]>(`/projects/${pid}/layouts`),
    enabled: !!pid,
  });
  const benchmark = useQuery({
    queryKey: ["benchmark", benchmarkId],
    queryFn: () => api<Benchmark>(`/benchmarks/${benchmarkId}`),
    enabled: !!benchmarkId,
  });
  const records = useQuery({
    queryKey: ["records", pid, kind],
    queryFn: () =>
      api<ResearchRecord[]>(
        `/projects/${pid}/records?limit=1000${kind ? "&kind=" + kind : ""}`,
      ),
    enabled: !!pid && view === "evidence",
  });
  const ontology = useQuery({
    queryKey: ["ontology"],
    queryFn: () => api<{ kinds: string[]; relations: string[] }>("/ontology"),
  });
  const graph = useQuery({
    queryKey: ["graph", pid, recordId, depth, relation],
    queryFn: () =>
      api<Graph>(
        `/projects/${pid}/graph?depth=${depth}&limit=60${recordId ? "&root=" + recordId : ""}${relation ? "&relation=" + relation : ""}`,
      ),
    enabled: !!pid && (view === "evidence" || view === "overview"),
  });
  useEffect(() => {
    if (!pid && projects.data?.length)
      setPid(
        projects.data.find((p) => p.label === "Evidence under revision")?.id ??
          projects.data[0].id,
      );
  }, [projects.data, pid]);
  useEffect(() => {
    if (!runId && runs.data?.length) {
      const r =
        runs.data.find(
          (r) => r.target === "first-match" && r.status === "complete",
        ) ?? runs.data[0];
      setRunId(r.id);
      setBeforeId(r.id);
      setAfterId(
        runs.data.find((r2) => r2.id !== r.id && r2.status === "complete")
          ?.id ?? "",
      );
    }
  }, [runs.data, runId]);
  useEffect(() => {
    if (!benchmarkId && datasets.data?.length)
      setBenchmarkId(datasets.data.find((d) => d.payload.benchmark)?.id ?? "");
  }, [datasets.data, benchmarkId]);
  useEffect(() => {
    setPage(0);
  }, [family, search, failuresOnly, runId, latencyRange]);
  useEffect(() => {
    localStorage.setItem("nx-actor", actor);
  }, [actor]);
  const project = projects.data?.find((p) => p.id === pid);
  const current = run.data;
  const metrics = current?.summary.metrics;
  const filtered = useMemo(
    () =>
      (current?.results ?? []).filter(
        (r) =>
          (family === "all" || r.family === family) &&
          (!failuresOnly || !r.scores.correct) &&
          (!search || r.case_id.toLowerCase().includes(search.toLowerCase())) &&
          (!latencyRange ||
            (r.latency_ms >= latencyRange[0] &&
              r.latency_ms <= latencyRange[1])),
      ),
    [current, family, failuresOnly, search, latencyRange],
  );
  const visibleGraphNodes = (graph.data?.nodes ?? []).filter(
    (n) => !graphKind || n.kind === graphKind,
  );
  const visibleNodeIds = new Set(visibleGraphNodes.map((n) => n.id));
  async function action<T>(
    name: string,
    callback: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const value = await callback();
      await client.invalidateQueries();
      setNotice(`${name} complete`);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  function chooseProject(id: string) {
    setPid(id);
    setRunId("");
    setBenchmarkId("");
    setRecordId("");
    setSelectedResult(null);
    setComparison(null);
    setFamily("all");
    setBeforeId("");
    setAfterId("");
    setCaseDetail(null);
  }
  function inspect(id: string) {
    setRecordId(id);
    setInspector(true);
    setCaseDetail(null);
  }
  function chooseRun(id: string) {
    setRunId(id);
    setSelectedResult(null);
    setRecordId("");
    setLatencyRange(null);
    setFamily("all");
  }
  function inspectResult(result: Result) {
    setSelectedResult(result);
    inspect(result.claim_id);
  }
  const onSubmit =
    (callback: (form: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      callback(new FormData(e.currentTarget));
    };
  async function execute() {
    const result = await action("Evaluation", () =>
      api<Run>("/runs", {
        benchmark_id: benchmarkId,
        target,
        split,
        repeats,
        parameters,
        actor,
      }),
    );
    if (result) {
      chooseRun(result.id);
      setView("evaluations");
    }
  }
  async function compare() {
    const result = await action("Paired comparison", () =>
      api<Comparison>(`/compare?before=${beforeId}&after=${afterId}`),
    );
    if (result) setComparison(result);
  }
  async function rerun(c: Correction, scope: "affected" | "full") {
    const result = await action("Correction rerun", () =>
      api<Run>(`/corrections/${c.id}/rerun`, { scope, actor }),
    );
    if (result) {
      chooseRun(result.id);
      setBeforeId(c.payload.run_id);
      setAfterId(result.id);
      const paired = await action("Paired comparison", () =>
        api<Comparison>(
          `/compare?before=${c.payload.run_id}&after=${result.id}`,
        ),
      );
      if (paired) setComparison(paired);
      setView("evaluations");
    }
  }
  const queryError = [
    projects.error,
    runs.error,
    datasets.error,
    run.error,
    record.error,
    corrections.error,
    benchmark.error,
    records.error,
    graph.error,
    layouts.error,
  ].find(Boolean);

  const resultTable = (
    <section className="panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">
            OBSERVATIONS / {filtered.length} OF {current?.results.length ?? 0}
          </span>
          <h3>Inspect the result behind the measurement</h3>
        </div>
        <button
          className="text-button"
          disabled={!runId}
          onClick={() =>
            action("CSV export", () =>
              exportFile(
                `/runs/${runId}/results.csv`,
                "evaluation-results.csv",
              ),
            )
          }
        >
          <ArrowDownToLine size={14} /> CSV
        </button>
      </header>
      <div className="table-filters">
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Search case IDs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a case…"
          />
        </label>
        <label>
          Family{" "}
          <select
            aria-label="Case family"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            <option value="all">All families</option>
            {Object.keys(current?.summary.groups ?? {}).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(e) => setFailuresOnly(e.target.checked)}
          />{" "}
          Failures only
        </label>
        {latencyRange && (
          <button className="text-button" onClick={() => setLatencyRange(null)}>
            Clear latency selection
          </button>
        )}
      </div>
      <div className="table-scroll results-scroll">
        <table className="results-table">
          <thead>
            <tr>
              <th>Case / evidence</th>
              <th>Repeat</th>
              <th>Policy answer</th>
              <th>Assessment</th>
              <th>Latency</th>
              <th>
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 30, page * 30 + 30).map((r) => (
              <tr
                key={r.id}
                className={selectedResult?.id === r.id ? "selected-row" : ""}
              >
                <td>
                  <button
                    className="record-link"
                    onClick={() => inspectResult(r)}
                  >
                    {r.case_id}
                  </button>
                  <span className="cell-meta">{r.family}</span>
                </td>
                <td className="mono">{r.repeat + 1}</td>
                <td className="mono">{r.prediction.answer ?? "Abstained"}</td>
                <td>
                  <Status tone={r.scores.correct ? "good" : "warning"}>
                    {r.scores.correct
                      ? "Correct"
                      : title(r.scores.error ?? "Error")}
                  </Status>
                </td>
                <td className="mono">{r.latency_ms.toFixed(4)} ms</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Inspect ${r.case_id} repeat ${r.repeat + 1}`}
                    onClick={() => inspectResult(r)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <EmptyState title="No matching observations">
          Adjust the filters or execute a benchmark.
        </EmptyState>
      )}
      <footer className="table-footer">
        <span>
          Ground truth: synthetic fixture oracle · Repeats are not independent
          cases.
        </span>
        <div>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(filtered.length / 30))}
          </span>
          <button
            disabled={(page + 1) * 30 >= filtered.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );

  const metricStrip = current?.status === "complete" && (
    <div className="metric-strip">
      <MetricCard
        label="EXACT ACCURACY"
        value={percent(metrics?.accuracy.value)}
        note={`${metrics?.accuracy.numerator ?? 0} / ${metrics?.accuracy.denominator ?? 0} unique cases`}
      />
      <MetricCard
        label="UNSUPPORTED ASSERTIONS"
        value={percent(metrics?.unsupported_assertion_rate.value)}
        note={`${metrics?.unsupported_assertion_rate.numerator ?? 0} / ${metrics?.unsupported_assertion_rate.denominator ?? 0} answered cases`}
        tone="copper"
      />
      <MetricCard
        label="PREDICT LATENCY"
        value={`${metrics?.latency_ms.value?.toFixed(3) ?? "—"}`}
        note={`ms · mean of ${current.summary.executions} measured calls`}
      />
      <MetricCard
        label="EVALUATION SCOPE"
        value={String(current.summary.unique_cases)}
        note={`${current.split} cases · ${current.request.repeats} repeats`}
      />
    </div>
  );
  const charts = current?.status === "complete" && (
    <div className="two-panels">
      <ChartFrame
        title="Performance by case family"
        description="Exact answer accuracy · fixed synthetic cases · click to filter"
      >
        <MetricBars
          data={Object.entries(current.summary.groups).map(([id, g]) => ({
            id,
            label: title(id),
            value: g.accuracy,
            n: g.cases,
            sourceId: current.execution_id,
          }))}
          selected={family}
          onSelect={(id) => setFamily((f) => (f === id ? "all" : id))}
        />
      </ChartFrame>
      <ChartFrame
        title="Execution measurements"
        description="Actual prediction timing · selected family linked to the table"
      >
        <ScatterPlot
          data={filtered.map((r, i) => ({
            id: r.id,
            x: r.latency_ms,
            y: i,
            label: `${r.case_id} / repeat ${r.repeat + 1}`,
            sourceId: r.output_id,
            correct: r.scores.correct,
          }))}
          onSelect={(id) => {
            const r = filtered.find((r) => r.id === id);
            if (r) inspectResult(r);
          }}
        />
      </ChartFrame>
    </div>
  );

  const inspectorContent = (
    <>
      <div className="inspector-title">
        <span className="eyebrow">TRACE / INSPECTOR</span>
        <button
          className="icon-button"
          aria-label="Close inspector"
          onClick={() => setInspector(false)}
        >
          <X size={16} />
        </button>
      </div>
      {record.isFetching && <p role="status">Loading research record…</p>}
      {caseDetail ? (
        <>
          <h2>{caseDetail.id}</h2>
          <Status>Fixture ground truth</Status>
          <p>{caseDetail.question}</p>
          <pre>{JSON.stringify(caseDetail, null, 2)}</pre>
        </>
      ) : record.data ? (
        <>
          <span className="record-kind">
            {title(record.data.kind)} · v{record.data.version}
          </span>
          <h2>{record.data.label}</h2>
          <div className="record-id mono">{record.data.id}</div>
          {claim.data && (
            <div className="evidence-assessment">
              <Status
                tone={claim.data.status === "supported" ? "good" : "warning"}
              >
                {title(claim.data.status)}
              </Status>
              <p>
                {claim.data.incomplete_provenance
                  ? "Source lineage is incomplete."
                  : "A source can be reached through recorded derivation links."}
              </p>
              <small>
                Basis: {claim.data.basis.join(", ") || "No assessed evidence"}.{" "}
                {claim.data.caveat}
              </small>
            </div>
          )}
          {selectedResult && recordId === selectedResult.claim_id && (
            <div className="inspection-result">
              <span className="eyebrow">MEASURED OUTPUT</span>
              <strong>{selectedResult.prediction.answer ?? "Abstained"}</strong>
              <dl>
                <dt>Case</dt>
                <dd>{selectedResult.case_id}</dd>
                <dt>Repeat</dt>
                <dd>{selectedResult.repeat + 1}</dd>
                <dt>Predict time</dt>
                <dd>{selectedResult.latency_ms.toFixed(5)} ms</dd>
              </dl>
              <button
                className="text-button"
                onClick={() => inspect(selectedResult.output_id)}
              >
                Open output & execution <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <details open className="inspector-section">
            <summary>
              Provenance relationships{" "}
              <span>{record.data.outgoing?.length ?? 0}</span>
            </summary>
            {record.data.outgoing?.map((e) => (
              <button
                className="edge-link"
                key={e.id}
                onClick={() => inspect(e.target_id)}
              >
                <span>
                  {title(e.relation)}
                  <small>{e.assessment}</small>
                </span>
                <span className="mono">
                  {short(e.target_id)} <ChevronRight size={13} />
                </span>
              </button>
            ))}
            {!record.data.outgoing?.length && (
              <p>No outgoing provenance links.</p>
            )}
          </details>
          <details className="inspector-section">
            <summary>
              Incoming links & annotations{" "}
              <span>{record.data.incoming?.length ?? 0}</span>
            </summary>
            {record.data.incoming?.map((e) => (
              <button
                className="edge-link"
                key={e.id}
                onClick={() => inspect(e.source_id)}
              >
                <span>{title(e.relation)}</span>
                <span className="mono">
                  {short(e.source_id)} <ChevronRight size={13} />
                </span>
              </button>
            ))}
          </details>
          <details className="inspector-section">
            <summary>
              Version history <span>{record.data.history?.length}</span>
            </summary>
            {record.data.history?.map((h) => (
              <button
                key={h.id}
                className="edge-link"
                onClick={() => inspect(h.id)}
              >
                <span>
                  Version {h.version}
                  <small>
                    {h.actor} · {new Date(h.created * 1000).toLocaleString()}
                  </small>
                </span>
                <span className="mono">{short(h.content_hash)}</span>
              </button>
            ))}
            <p>
              Inspect each version to compare payloads; earlier records remain
              unchanged.
            </p>
          </details>
          <details className="inspector-section">
            <summary>Raw record & content hash</summary>
            <p className="mono hash">SHA-256 {record.data.content_hash}</p>
            <pre>{JSON.stringify(record.data.payload, null, 2)}</pre>
            <button
              onClick={() =>
                download(
                  `record-${short(recordId)}.json`,
                  JSON.stringify(record.data, null, 2),
                )
              }
            >
              Export record
            </button>
          </details>
          {selectedResult &&
            !selectedResult.scores.correct &&
            recordId === selectedResult.claim_id &&
            current?.split === "development" && (
              <section className="inspector-section correction-form">
                <h3>Propose a correction</h3>
                <p>
                  Change a rule in a new configuration. Review is required
                  before rerunning.
                </p>
                <form
                  key={selectedResult.id}
                  onSubmit={onSubmit(async (f) => {
                    const result = await action("Correction proposal", () =>
                      api("/corrections", {
                        run_id: runId,
                        case_id: selectedResult.case_id,
                        rule: f.get("rule"),
                        rationale: f.get("rationale"),
                        actor,
                      }),
                    );
                    if (result) setView("reviews");
                  })}
                >
                  <Field label="Algorithm rule">
                    <select
                      name="rule"
                      defaultValue={
                        suggestion[selectedResult.family] ?? "prefer_latest"
                      }
                    >
                      {rules.map((r) => (
                        <option key={r} value={r}>
                          {title(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Correction rationale">
                    <textarea
                      name="rationale"
                      required
                      minLength={5}
                      maxLength={2000}
                      placeholder="Explain the failure and the proposed change…"
                    />
                  </Field>
                  <button
                    className="primary"
                    disabled={!!busy || !actor.trim()}
                  >
                    Submit correction
                  </button>
                </form>
              </section>
            )}
          <details className="inspector-section">
            <summary>Add a human annotation</summary>
            <form
              onSubmit={onSubmit(async (f) => {
                const result = await action("Annotation", async () => {
                  const a = await api<ResearchRecord>(
                    `/projects/${pid}/records`,
                    {
                      kind: "annotation",
                      label: `Note on ${record.data!.label}`.slice(0, 200),
                      payload: { text: f.get("text"), interpretation: true },
                      actor,
                    },
                  );
                  await api("/edges", {
                    source_id: a.id,
                    target_id: recordId,
                    relation: "associated_with",
                    actor,
                  });
                  return a;
                });
                if (result) inspect(result.id);
              })}
            >
              <Field label="Interpretation">
                <textarea name="text" required maxLength={2000} />
              </Field>
              <button disabled={!!busy}>Record annotation</button>
            </form>
            <p>Attributed interpretation, separate from measured results.</p>
          </details>
          {record.data.kind === "annotation" && (
            <details className="inspector-section">
              <summary>Revise annotation</summary>
              <form
                onSubmit={onSubmit(async (f) => {
                  const result = await action("Annotation revision", () =>
                    api<ResearchRecord>(`/records/${recordId}/versions`, {
                      expected_version: record.data!.version,
                      record: {
                        kind: "annotation",
                        label: record.data!.label,
                        payload: {
                          ...record.data!.payload,
                          text: f.get("text"),
                        },
                        actor,
                      },
                    }),
                  );
                  if (result) inspect(result.id);
                })}
              >
                <Field label="Revised interpretation">
                  <textarea
                    name="text"
                    required
                    defaultValue={String(record.data.payload.text)}
                  />
                </Field>
                <button disabled={!!busy}>Save new version</button>
              </form>
            </details>
          )}
          {claim.data && (
            <details className="inspector-section">
              <summary>Challenge an evidence assessment</summary>
              <form
                onSubmit={onSubmit(async (f) => {
                  await action("Evidence challenge", () =>
                    api("/edges", {
                      source_id: recordId,
                      target_id: f.get("evidence"),
                      relation: "contradicted_by",
                      assessment: "human_judgment",
                      rationale: f.get("rationale"),
                      actor,
                    }),
                  );
                })}
              >
                <Field label="Evidence record ID">
                  <input
                    name="evidence"
                    required
                    placeholder="Paste an evidence or output UUID"
                  />
                </Field>
                <Field label="Challenge rationale">
                  <textarea name="rationale" required minLength={3} />
                </Field>
                <button disabled={!!busy}>Record challenge</button>
              </form>
            </details>
          )}
          <p className="inspector-attribution">
            Recorded by {record.data.actor}
            <br />
            {new Date(record.data.created * 1000).toLocaleString()}
          </p>
        </>
      ) : (
        <EmptyState title="Follow the evidence">
          <p>
            Select a case, chart point, or graph node to inspect its source
            records and history.
          </p>
          <div className="lineage-preview">
            OUTPUT
            <ChevronRight size={14} />
            EXECUTION
            <ChevronRight size={14} />
            SOURCE
          </div>
        </EmptyState>
      )}
    </>
  );

  return (
    <>
      <Workspace
        width={width}
        onResize={setWidth}
        inspector={inspector ? inspectorContent : undefined}
        sidebar={
          <>
            <div className="brand">
              <div className="brand-symbol" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>
                NUROWERX<span>RESEARCH SYSTEMS</span>
              </span>
            </div>
            <div className="project-switch">
              <span className="eyebrow">WORKSPACE</span>
              <select
                aria-label="Research project"
                value={pid}
                onChange={(e) => chooseProject(e.target.value)}
              >
                {!projects.data?.length && (
                  <option value="">Select project</option>
                )}
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                className="text-button"
                onClick={() => setModal("project")}
              >
                <Plus size={14} /> New project
              </button>
            </div>
            <nav>
              {views.map((v) => (
                <button
                  key={v.id}
                  className={view === v.id ? "nav-item active" : "nav-item"}
                  aria-current={view === v.id ? "page" : undefined}
                  onClick={() => setView(v.id)}
                >
                  <v.icon size={17} />
                  <span>{v.label}</span>
                  {view === v.id && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="system-list">
                <span>TRACE</span>
                <span>LOOP</span>
                <span>LENS</span>
                <span>FRAME</span>
              </div>
              <p>
                FROM INFORMATION
                <br />
                TO UNDERSTANDING.
              </p>
              <div className="local-indicator">
                <span />
                Local research environment
              </div>
              <button
                className="text-button"
                onClick={() => setModal("access")}
              >
                <Settings2 size={14} /> Access & attribution
              </button>
              <span className="version">RESEARCH STACK / 0.1.1</span>
            </div>
          </>
        }
        header={
          <>
            <div className="breadcrumb">
              <span>Research systems</span>
              <ChevronRight size={13} />
              <strong>{views.find((v) => v.id === view)?.system}</strong>
              <span className="top-divider" />
              <Status>Synthetic benchmark</Status>
            </div>
            <div className="topbar-actions">
              <select
                aria-label="Restore saved workspace"
                defaultValue=""
                onChange={(e) => {
                  const l = layouts.data?.find((l) => l.id === e.target.value);
                  if (l) {
                    setView(l.configuration.view);
                    setWidth(l.configuration.inspector_width);
                    setRunId(l.configuration.run_id ?? "");
                    setFamily(l.configuration.family);
                  }
                  e.target.value = "";
                }}
              >
                <option value="">Saved layouts</option>
                {layouts.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="Save workspace layout"
                disabled={!pid}
                onClick={() => setModal("layout")}
              >
                <Save size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={inspector ? "Hide inspector" : "Show inspector"}
                onClick={() => setInspector((i) => !i)}
              >
                {inspector ? (
                  <PanelRightClose size={18} />
                ) : (
                  <PanelRightOpen size={18} />
                )}
              </button>
              <span className="avatar" title={actor}>
                {actor.slice(0, 2).toUpperCase()}
              </span>
            </div>
          </>
        }
      >
        {(error || queryError) && (
          <div className="alert" role="alert">
            <span>{error || String(queryError)}</span>
            <button
              onClick={() => {
                setError("");
                client.invalidateQueries();
              }}
            >
              Retry / refresh
            </button>
            <button onClick={() => setModal("access")}>Access settings</button>
          </div>
        )}
        {busy && (
          <div className="notice busy" role="status">
            <span className="spinner" />
            {busy} in progress…
          </div>
        )}
        {notice && !busy && (
          <div className="notice" role="status">
            <Check size={14} />
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {views.find((v) => v.id === view)?.system} / RESEARCH WORKSPACE
            </span>
            <h1>
              {view === "overview"
                ? (project?.label ?? "A traceable place to begin")
                : views.find((v) => v.id === view)?.label}
            </h1>
            <p>
              {view === "overview"
                ? "From a measured result to the evidence that explains it."
                : view === "evaluations"
                  ? "Run controlled comparisons. Preserve every configuration and result."
                  : view === "evidence"
                    ? "Inspect derivation, challenge claims, and follow the original source."
                    : view === "datasets"
                      ? "Versioned inputs, explicit oracles, and reproducible case definitions."
                      : "Human judgments recorded alongside the measurements they address."}
            </p>
          </div>
          <div className="heading-actions">
            <button
              disabled={!runId || current?.status !== "complete"}
              onClick={async () => {
                const report = await action("Report preview", () =>
                  api<unknown>(`/runs/${runId}/report`),
                );
                if (report) {
                  setReportPreview(report);
                  setModal("report");
                }
              }}
            >
              View report
            </button>
            <button
              disabled={!runId || current?.status !== "complete"}
              onClick={() =>
                action("Report export", () =>
                  exportFile(
                    `/runs/${runId}/report`,
                    `report-${short(runId)}.json`,
                  ),
                )
              }
            >
              <ArrowDownToLine size={15} /> Export report
            </button>
            <button
              className="primary"
              disabled={!pid}
              onClick={() => {
                setView("evaluations");
                document
                  .getElementById("evaluation-setup")
                  ?.scrollIntoView({ behavior: "instant" });
              }}
            >
              <Play size={14} /> New evaluation
            </button>
          </div>
        </div>
        {!pid && (
          <EmptyState title="Create your first research project">
            <p>
              Register a synthetic benchmark, execute a policy, and inspect its
              provenance.
            </p>
            <button className="primary" onClick={() => setModal("project")}>
              Create project
            </button>
          </EmptyState>
        )}
        {pid && ["overview", "evaluations"].includes(view) && (
          <>
            <div className="run-context">
              <div>
                <span className="eyebrow">ACTIVE EVALUATION</span>
                <select
                  aria-label="Active evaluation"
                  value={runId}
                  onChange={(e) => chooseRun(e.target.value)}
                >
                  {!runs.data?.length && (
                    <option value="">No evaluations yet</option>
                  )}
                  {runs.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.target} / {r.split} /{" "}
                      {r.scope === "selected_cases" ? "affected cases / " : ""}
                      {short(r.id)} / {r.status}
                    </option>
                  ))}
                </select>
              </div>
              {current && (
                <div className="run-meta">
                  <Status
                    tone={current.status === "complete" ? "good" : "warning"}
                  >
                    {current.status}
                  </Status>
                  <button
                    className="text-button mono"
                    onClick={() => inspect(current.config_id)}
                  >
                    CONFIG {short(current.config_id)} <ArrowUpRight size={12} />
                  </button>
                  <button
                    className="text-button mono"
                    onClick={() => inspect(current.benchmark_id)}
                  >
                    DATA {short(current.benchmark_id)}{" "}
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              )}
            </div>
            {current?.status === "failed" && (
              <div className="alert" role="alert">
                Evaluation failed: {current.error}. The execution record is
                preserved.
              </div>
            )}
            {view === "evaluations" && (
              <section className="panel setup" id="evaluation-setup">
                <header className="panel-heading">
                  <div>
                    <span className="eyebrow">CONTROLLED EXECUTION</span>
                    <h3>Configure an evaluation</h3>
                  </div>
                  <Status>No API key required</Status>
                </header>
                <div className="form-grid">
                  <Field label="Benchmark version">
                    <select
                      aria-label="Benchmark version"
                      value={benchmarkId}
                      onChange={(e) => setBenchmarkId(e.target.value)}
                    >
                      {!datasets.data?.length && (
                        <option value="">Register a dataset first</option>
                      )}
                      {datasets.data
                        ?.filter((d) => d.payload.benchmark)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Evaluation target">
                    <select
                      value={target}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        setParameters({});
                      }}
                    >
                      <option value="first-match">
                        First-match / deterministic policy
                      </option>
                      <option value="evidence-aware">
                        Evidence-aware / deterministic policy
                      </option>
                    </select>
                  </Field>
                  <Field label="Data split">
                    <select
                      value={split}
                      onChange={(e) => setSplit(e.target.value)}
                    >
                      <option value="development">Development</option>
                      <option value="heldout">Held-out evaluation</option>
                    </select>
                  </Field>
                  <Field label="Repeats per case">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={repeats}
                      onChange={(e) => setRepeats(+e.target.value)}
                    />
                  </Field>
                </div>
                <details>
                  <summary>Explicit rule overrides</summary>
                  <div className="rule-options">
                    {rules.map((r) => (
                      <label key={r}>
                        {title(r)}
                        <select
                          aria-label={`Override ${r}`}
                          value={
                            parameters[r] === undefined
                              ? "default"
                              : String(parameters[r])
                          }
                          onChange={(e) =>
                            setParameters((p) => {
                              const next = { ...p };
                              if (e.target.value === "default") delete next[r];
                              else next[r] = e.target.value === "true";
                              return next;
                            })
                          }
                        >
                          <option value="default">Target default</option>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
                <footer className="setup-footer">
                  <p>
                    Targets receive input evidence only. The scorer retains the
                    fixture oracle.
                  </p>
                  <button
                    className="primary"
                    disabled={
                      !!busy || !benchmarkId || repeats < 1 || repeats > 5
                    }
                    onClick={execute}
                  >
                    <Play size={14} /> Run evaluation
                  </button>
                </footer>
              </section>
            )}
            {metricStrip}
            {charts}
            {current && (
              <p className="method-note">
                <FileText size={14} />
                {current.summary.uncertainty?.reason ??
                  "No completed measurements."}{" "}
                <button
                  className="text-button"
                  onClick={() => inspect(current.execution_id)}
                >
                  Inspect execution
                </button>
              </p>
            )}
            {view === "evaluations" && (
              <section className="panel comparison">
                <header className="panel-heading">
                  <div>
                    <span className="eyebrow">
                      PAIRED / SAME BENCHMARK & SPLIT
                    </span>
                    <h3>Compare configurations</h3>
                  </div>
                </header>
                <div className="compare-controls">
                  <Field label="Before evaluation">
                    <select
                      value={beforeId}
                      onChange={(e) => setBeforeId(e.target.value)}
                    >
                      <option value="">Select before</option>
                      {runs.data
                        ?.filter((r) => r.status === "complete")
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.target} / {r.split} / {short(r.id)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <ArrowUpRight size={20} />
                  <Field label="After evaluation">
                    <select
                      value={afterId}
                      onChange={(e) => setAfterId(e.target.value)}
                    >
                      <option value="">Select after</option>
                      {runs.data
                        ?.filter((r) => r.status === "complete")
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.target} / {r.split} / {short(r.id)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <button
                    disabled={!!busy || !beforeId || !afterId}
                    onClick={compare}
                  >
                    Compare runs
                  </button>
                </div>
                {comparison && (
                  <div
                    className="comparison-result"
                    data-testid="comparison-result"
                  >
                    <div>
                      <span className="eyebrow">PAIRED ACCURACY CHANGE</span>
                      <strong>
                        {comparison.accuracy_delta >= 0 ? "+" : ""}
                        {(comparison.accuracy_delta * 100).toFixed(1)}{" "}
                        <small>percentage points</small>
                      </strong>
                      <p>
                        {percent(comparison.before_accuracy)} →{" "}
                        {percent(comparison.after_accuracy)} ·{" "}
                        {comparison.paired_cases} shared cases
                      </p>
                    </div>
                    <div>
                      <Status
                        tone={
                          comparison.regression_detected ? "warning" : "good"
                        }
                      >
                        {comparison.regression_detected
                          ? "Regression detected"
                          : "No paired regression"}
                      </Status>
                      <p>
                        {comparison.improved} improved · {comparison.regressed}{" "}
                        regressed · {comparison.unchanged} unchanged
                      </p>
                      {comparison.partial_overlap && (
                        <p className="copper">
                          Partial overlap: this is an affected-case comparison,
                          not a full benchmark result.
                        </p>
                      )}
                      <p>{comparison.method}</p>
                      <button
                        className="text-button"
                        onClick={() =>
                          download(
                            "paired-comparison.json",
                            JSON.stringify(comparison, null, 2),
                          )
                        }
                      >
                        Export paired results
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            {resultTable}
            {view === "evaluations" && current?.status === "complete" && (
              <div className="two-panels">
                <ChartFrame
                  title="Latency distribution"
                  description="Observed predict calls, grouped into bins. Select a bin to filter observations."
                >
                  <Histogram
                    values={current.results.map((r) => r.latency_ms)}
                    onSelect={setLatencyRange}
                  />
                </ChartFrame>
                <section className="panel">
                  <header className="panel-heading">
                    <h3>Auditable metric definitions</h3>
                  </header>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Value</th>
                          <th>Denominator</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(current.summary.metrics).map(
                          ([name, m]) => (
                            <tr key={name}>
                              <td>
                                <details>
                                  <summary>{title(name)}</summary>
                                  <p>{m.definition ?? m.reason}</p>
                                </details>
                              </td>
                              <td className="mono">
                                {name === "latency_ms"
                                  ? m.value?.toFixed(4)
                                  : percent(m.value)}
                              </td>
                              <td className="mono">
                                {m.denominator ?? m.n ?? "N/A"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="chart-footnote">
                    Process RSS snapshots:{" "}
                    {(
                      current.summary.resources.rss_before_bytes / 1048576
                    ).toFixed(1)}{" "}
                    →{" "}
                    {(
                      current.summary.resources.rss_after_bytes / 1048576
                    ).toFixed(1)}{" "}
                    MiB. {current.summary.resources.scope}
                  </p>
                </section>
              </div>
            )}
            {view === "overview" && (
              <div className="two-panels">
                <section className="panel">
                  <header className="panel-heading">
                    <div>
                      <span className="eyebrow">CONNECTED EVIDENCE</span>
                      <h3>Investigate the source</h3>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("evidence")}
                    >
                      Open TRACE <ArrowUpRight size={14} />
                    </button>
                  </header>
                  {recordId && graph.data ? (
                    <ProvenanceGraph
                      nodes={graph.data.nodes}
                      edges={graph.data.edges}
                      selected={recordId}
                      onSelect={inspect}
                    />
                  ) : (
                    <EmptyState title="A result is the beginning of an investigation">
                      Select an observation above to reveal its source and
                      execution graph.
                    </EmptyState>
                  )}
                </section>
                <ChartFrame
                  title="Evaluation timeline"
                  description="Recorded accuracy at execution time. Select a run to inspect its scope."
                >
                  <TimeSeries
                    data={(runs.data ?? [])
                      .filter((r) => r.status === "complete")
                      .sort((a, b) => a.created - b.created)
                      .map((r) => ({
                        id: r.id,
                        x: r.created * 1000,
                        y: r.summary.metrics.accuracy.value ?? 0,
                        label: `${r.target} / ${r.split} / ${r.scope}`,
                        sourceId: r.execution_id,
                      }))}
                    onSelect={chooseRun}
                    label="Evaluation accuracy history"
                  />
                  <p className="chart-footnote">
                    Each point is a separate run. Different splits and case
                    scopes are not directly comparable; use paired comparison in
                    LOOP.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setView("reviews")}
                  >
                    {corrections.data?.length ?? 0} recorded correction
                    proposals <ArrowUpRight size={14} />
                  </button>
                </ChartFrame>
              </div>
            )}
          </>
        )}
        {pid && view === "evidence" && (
          <>
            <section className="panel">
              <header className="panel-heading">
                <div>
                  <span className="eyebrow">
                    TRACE / VERSION-SPECIFIC RELATIONSHIPS
                  </span>
                  <h3>Provenance network</h3>
                </div>
                <div className="inline-actions">
                  <button
                    onClick={() =>
                      action("Integrity check", async () => {
                        const result = await api<{
                          ok: boolean;
                          records_checked: number;
                          edges_checked: number;
                        }>(`/projects/${pid}/integrity`);
                        if (!result.ok)
                          throw new Error("Content hash consistency failed");
                        setNotice(
                          `Verified ${result.records_checked} records and ${result.edges_checked} edges`,
                        );
                        return result;
                      })
                    }
                  >
                    Verify hashes
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "provenance-graph.json",
                        JSON.stringify(graph.data, null, 2),
                      )
                    }
                  >
                    Export graph
                  </button>
                  <button
                    onClick={() =>
                      action("Project export", () =>
                        exportFile(
                          `/projects/${pid}/export`,
                          "project-provenance.json",
                        ),
                      )
                    }
                  >
                    Full project
                  </button>
                </div>
              </header>
              <div className="table-filters">
                <Field label="Relationship">
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value)}
                  >
                    <option value="">All relationships</option>
                    {ontology.data?.relations.map((r) => (
                      <option key={r} value={r}>
                        {title(r)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Visible entity type">
                  <select
                    value={graphKind}
                    onChange={(e) => setGraphKind(e.target.value)}
                  >
                    <option value="">All entity types</option>
                    {ontology.data?.kinds.map((k) => (
                      <option key={k} value={k}>
                        {title(k)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Traversal depth">
                  <select
                    value={depth}
                    onChange={(e) => setDepth(+e.target.value)}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <button
                  onClick={() => {
                    setRecordId("");
                    setGraphKind("");
                    setRelation("");
                  }}
                >
                  Reset selection
                </button>
              </div>
              {graph.data && (
                <ProvenanceGraph
                  nodes={visibleGraphNodes}
                  edges={graph.data.edges.filter(
                    (e) =>
                      visibleNodeIds.has(e.source_id) &&
                      visibleNodeIds.has(e.target_id),
                  )}
                  selected={recordId}
                  onSelect={inspect}
                />
              )}
              <p className="chart-footnote">
                {visibleGraphNodes.length} visible records.{" "}
                {graph.data?.truncated
                  ? "Traversal capped at 60 nodes; select a specific record to narrow the neighborhood."
                  : "All records in this neighborhood are shown."}
              </p>
              <details className="data-alternative">
                <summary>Graph records and relationships</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Entity</th>
                      <th>Type</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGraphNodes.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <button onClick={() => inspect(n.id)}>
                            {n.label}
                          </button>
                        </td>
                        <td>{title(n.kind)}</td>
                        <td className="mono">{short(n.id)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Relationship</th>
                      <th>Target</th>
                      <th>Assessment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graph.data?.edges.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <button onClick={() => inspect(e.source_id)}>
                            {short(e.source_id)}
                          </button>
                        </td>
                        <td>{e.relation}</td>
                        <td>
                          <button onClick={() => inspect(e.target_id)}>
                            {short(e.target_id)}
                          </button>
                        </td>
                        <td>{e.assessment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
            <section className="panel">
              <header className="panel-heading">
                <h3>Research records</h3>
                <Field label="Record type">
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="">All record types</option>
                    {ontology.data?.kinds.map((k) => (
                      <option key={k} value={k}>
                        {title(k)}
                      </option>
                    ))}
                  </select>
                </Field>
              </header>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Type</th>
                      <th>Version</th>
                      <th>Actor</th>
                      <th>Content hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.data?.slice(0, 100).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="record-link"
                            onClick={() => inspect(r.id)}
                          >
                            {r.label}
                          </button>
                        </td>
                        <td>{title(r.kind)}</td>
                        <td>{r.version}</td>
                        <td>{r.actor}</td>
                        <td className="mono">{short(r.content_hash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chart-footnote">
                Showing the most recent 100 records of this type. Full project
                export includes every record.
              </p>
            </section>
          </>
        )}
        {pid && view === "datasets" && (
          <>
            <div className="two-panels">
              <section className="panel">
                <header className="panel-heading">
                  <div>
                    <span className="eyebrow">DETERMINISTIC INPUTS</span>
                    <h3>Register a synthetic benchmark</h3>
                  </div>
                  <Database size={20} />
                </header>
                <form
                  onSubmit={onSubmit(async (f) => {
                    const result = await action("Dataset registration", () =>
                      api<ResearchRecord>(`/projects/${pid}/fixtures`, {
                        seed: Number(f.get("seed")),
                        per_family: Number(f.get("per_family")),
                        actor,
                      }),
                    );
                    if (result) {
                      setBenchmarkId(result.id);
                      inspect(result.id);
                    }
                  })}
                >
                  <div className="form-grid">
                    <Field label="Random seed">
                      <input
                        name="seed"
                        type="number"
                        defaultValue={20261102}
                        required
                      />
                    </Field>
                    <Field label="Cases per family">
                      <input
                        name="per_family"
                        type="number"
                        min={2}
                        max={100}
                        defaultValue={20}
                        required
                      />
                    </Field>
                  </div>
                  <p>
                    Six families: lookup, revision, conflict, missing evidence,
                    distractors, and recovery. Half the instances are
                    development cases; the remainder are held out.
                  </p>
                  <button className="primary" disabled={!!busy}>
                    Register benchmark
                  </button>
                </form>
              </section>
              <section className="panel">
                <header className="panel-heading">
                  <h3>Import benchmark JSON</h3>
                </header>
                <p>
                  Accepts the documented synthetic Benchmark schema. Imported
                  inputs and oracle labels become a content-hashed dataset
                  version.
                </p>
                <Field label="Benchmark JSON file">
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const result = await action(
                          "Benchmark import",
                          async () =>
                            api<ResearchRecord>(
                              `/projects/${pid}/benchmarks`,
                              JSON.parse(await file.text()),
                            ),
                        );
                        if (result) setBenchmarkId(result.id);
                      }
                      e.target.value = "";
                    }}
                  />
                </Field>
                <p className="chart-footnote">
                  Representative fixtures are labeled synthetic. External
                  research exports use the independent CLI adapters.
                </p>
              </section>
            </div>
            <section className="panel">
              <header className="panel-heading">
                <h3>Registered dataset versions</h3>
              </header>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Dataset / version</th>
                      <th>Cases</th>
                      <th>Source</th>
                      <th>Content hash</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.data?.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <button
                            className="record-link"
                            onClick={() => {
                              if (d.payload.benchmark) setBenchmarkId(d.id);
                              inspect(d.id);
                            }}
                          >
                            {d.label}
                          </button>
                          <span className="cell-meta">Version {d.version}</span>
                        </td>
                        <td>
                          {d.payload.benchmark?.cases.length ??
                            d.payload.validation?.unique_cases ??
                            "—"}
                        </td>
                        <td>
                          {d.payload.benchmark
                            ? "Synthetic fixture"
                            : (d.payload.adapter ?? "Imported data")}
                        </td>
                        <td className="mono">
                          {short(d.payload.content_hash)}
                        </td>
                        <td>
                          <button
                            aria-label={`Inspect dataset ${short(d.id)}`}
                            onClick={() => inspect(d.id)}
                          >
                            <ArrowUpRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {benchmark.data && (
              <section className="panel">
                <header className="panel-heading">
                  <div>
                    <span className="eyebrow">
                      SEED {benchmark.data.benchmark.seed} / SYNTHETIC ORACLE
                    </span>
                    <h3>{benchmark.data.benchmark.name}</h3>
                  </div>
                  <button
                    onClick={() =>
                      download(
                        "benchmark.json",
                        JSON.stringify(benchmark.data!.benchmark, null, 2),
                      )
                    }
                  >
                    Export benchmark
                  </button>
                </header>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Family</th>
                        <th>Split</th>
                        <th>Expected answer</th>
                        <th>Evidence items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmark.data.benchmark.cases.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="record-link"
                              onClick={() => {
                                setCaseDetail(c);
                                setInspector(true);
                              }}
                            >
                              {c.id}
                            </button>
                          </td>
                          <td>{c.family}</td>
                          <td>{c.split}</td>
                          <td className="mono">
                            {c.expected_answer ?? "Abstain"}
                          </td>
                          <td>{c.input.evidence.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
        {pid && view === "reviews" && (
          <>
            <div className="review-banner">
              <MessageSquare size={20} />
              <p>
                Review decisions are attributed human judgments. Conflicting
                current votes block a correction; later decisions preserve the
                full history.
              </p>
              <Field label="Researcher / reviewer">
                <input
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  maxLength={100}
                  required
                />
              </Field>
            </div>
            {!corrections.data?.length && (
              <EmptyState title="No corrections recorded">
                <p>
                  Open a failed development case, inspect its evidence, and
                  propose a rule change in the inspector.
                </p>
                <button
                  onClick={() => {
                    setView("evaluations");
                    setFailuresOnly(true);
                  }}
                >
                  Inspect failed cases
                </button>
              </EmptyState>
            )}
            {corrections.data?.map((c) => (
              <section className="panel review-card" key={c.id}>
                <header className="panel-heading">
                  <div>
                    <span className="eyebrow">CORRECTION / {short(c.id)}</span>
                    <h3>{c.label}</h3>
                  </div>
                  <Status
                    tone={c.review_status === "accepted" ? "good" : "warning"}
                  >
                    {c.review_status}
                  </Status>
                </header>
                <p>{String(c.payload.rationale)}</p>
                <div className="review-meta">
                  <span>Proposed by {c.actor}</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      chooseRun(c.payload.run_id);
                      setView("evaluations");
                    }}
                  >
                    Original run {short(c.payload.run_id)}{" "}
                    <ArrowUpRight size={13} />
                  </button>
                  <button className="text-button" onClick={() => inspect(c.id)}>
                    Inspect provenance
                  </button>
                </div>
                <form
                  className="review-form"
                  onSubmit={onSubmit(async (f) => {
                    await action("Review decision", () =>
                      api(`/corrections/${c.id}/reviews`, {
                        decision: f.get("decision"),
                        rationale: f.get("rationale"),
                        actor,
                      }),
                    );
                  })}
                >
                  <Field label="Review decision">
                    <select name="decision">
                      <option value="accept">Accept correction</option>
                      <option value="reject">Reject correction</option>
                    </select>
                  </Field>
                  <Field label="Review rationale">
                    <input
                      name="rationale"
                      required
                      minLength={3}
                      placeholder="Explain your decision…"
                    />
                  </Field>
                  <button disabled={!!busy || !actor.trim()}>
                    Record review
                  </button>
                </form>
                <details open={c.reviews.length > 0}>
                  <summary>Review history ({c.reviews.length})</summary>
                  {c.reviews.map((r) => (
                    <div className="review-history" key={r.id}>
                      <Status
                        tone={
                          r.payload.decision === "accept" ? "good" : "warning"
                        }
                      >
                        {r.payload.decision}
                      </Status>
                      <strong>{r.actor}</strong>
                      <span>{r.payload.rationale}</span>
                      <time>{new Date(r.created * 1000).toLocaleString()}</time>
                    </div>
                  ))}
                </details>
                <footer className="setup-footer">
                  <p>
                    Accepted corrections create a new run. Original results
                    remain immutable.
                  </p>
                  <div className="inline-actions">
                    <button
                      disabled={!!busy || c.review_status !== "accepted"}
                      onClick={() => rerun(c, "full")}
                    >
                      Rerun full split
                    </button>
                    <button
                      className="primary"
                      disabled={!!busy || c.review_status !== "accepted"}
                      onClick={() => rerun(c, "affected")}
                    >
                      Rerun affected case
                    </button>
                  </div>
                </footer>
              </section>
            ))}
          </>
        )}
        <footer className="workspace-footer">
          <span>NUROWERX / RESEARCH SYSTEMS</span>
          <span>
            Measured evidence · Attributed interpretation · Preserved history
          </span>
        </footer>
      </Workspace>
      {modal === "report" && (
        <Dialog
          title="Generated research report"
          onClose={() => setModal(null)}
        >
          <p>
            Actual exported JSON, including source records, configuration,
            corrections and reproduction digest.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: "65vh",
              overflow: "auto",
            }}
          >
            {JSON.stringify(reportPreview, null, 2)}
          </pre>
        </Dialog>
      )}
      {modal === "project" && (
        <Dialog title="Create research project" onClose={() => setModal(null)}>
          <form
            onSubmit={onSubmit(async (f) => {
              const p = await action("Project creation", () =>
                api<ResearchRecord>("/projects", {
                  label: f.get("label"),
                  actor,
                }),
              );
              if (p) {
                chooseProject(p.id);
                setView("datasets");
                setModal(null);
              }
            })}
          >
            <Field label="Project name">
              <input
                name="label"
                autoFocus
                required
                maxLength={200}
                placeholder="A research question or investigation"
              />
            </Field>
            <button className="primary" disabled={!!busy}>
              Create project
            </button>
          </form>
        </Dialog>
      )}
      {modal === "layout" && (
        <Dialog title="Save workspace layout" onClose={() => setModal(null)}>
          <form
            onSubmit={onSubmit(async (f) => {
              const result = await action("Layout saved", () =>
                api(`/projects/${pid}/layouts`, {
                  name: f.get("name"),
                  view,
                  inspector_width: width,
                  run_id: runId || null,
                  family,
                }),
              );
              if (result) setModal(null);
            })}
          >
            <Field label="Layout name">
              <input
                name="name"
                autoFocus
                required
                maxLength={100}
                defaultValue={`${views.find((v) => v.id === view)?.label} workspace`}
              />
            </Field>
            <p>
              Preserves the view, active evaluation, family filter, and
              inspector width.
            </p>
            <button className="primary" disabled={!!busy}>
              Save layout
            </button>
          </form>
        </Dialog>
      )}
      {modal === "access" && (
        <Dialog title="Access & attribution" onClose={() => setModal(null)}>
          <p>
            Mode: {health.data?.mode ?? "Checking server…"}. Researcher names
            are attribution labels, not verified identities.
          </p>
          <form
            onSubmit={onSubmit((f) => {
              setActor(String(f.get("actor")));
              const token = String(f.get("token") ?? "");
              if (token) sessionStorage.setItem("nx-token", token);
              else sessionStorage.removeItem("nx-token");
              client.invalidateQueries();
              setModal(null);
            })}
          >
            <Field label="Researcher name">
              <input
                name="actor"
                autoFocus
                required
                maxLength={100}
                defaultValue={actor}
              />
            </Field>
            <Field label="Optional access token">
              <input
                name="token"
                type="password"
                autoComplete="off"
                defaultValue={sessionStorage.getItem("nx-token") ?? ""}
              />
            </Field>
            <p>
              Tokens stay in this browser tab's session storage. Reader tokens
              cannot write records.
            </p>
            <button className="primary">Apply settings</button>
          </form>
        </Dialog>
      )}
    </>
  );
}
