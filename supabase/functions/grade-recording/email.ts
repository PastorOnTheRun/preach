// HTML email for Jake with the AI feedback. Pure (no I/O); sent via Resend in pipeline.ts.
import { fmtDuration, type TimingFacts } from "./rubric.ts";

export interface EmailInput {
  preacher: string;
  sermonTitle: string;
  date: string; // already formatted for humans
  timing: TimingFacts;
  grade: {
    overall: string;
    average: number | null;
    criteria: { name: string; score: number | null; max: number; comment: string }[];
    strengths: string[];
    growth_areas: string[];
    answer_to_question: string;
  };
  summary: string;
  question: string | null;
  reviewUrl: string;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const ORANGE = "#FF7010";
const INK = "#141110";

export function lengthLine(t: TimingFacts): string {
  const parts = [`${fmtDuration(t.actual_seconds)} preached`];
  if (t.planned_minutes != null) parts.push(`${t.planned_minutes} min planned`);
  if (t.overtime_seconds != null && t.overtime_seconds > 0) parts.push(`${fmtDuration(t.overtime_seconds)} over`);
  else if (t.overtime_seconds != null) parts.push("on time");
  if (t.wpm != null) parts.push(`${t.wpm} wpm`);
  return parts.join(" · ");
}

export function emailSubject(e: Pick<EmailInput, "preacher" | "sermonTitle" | "grade">): string {
  return `Sermon feedback: ${e.preacher} – “${e.sermonTitle}” (${e.grade.overall})`;
}

export function buildEmailHtml(e: EmailInput): string {
  const li = (items: string[]) =>
    items.length
      ? `<ul style="margin:6px 0 0;padding-left:20px">${items.map((s) => `<li style="margin:4px 0">${esc(s)}</li>`).join("")}</ul>`
      : `<p style="margin:6px 0 0;color:#777">—</p>`;
  const rows = e.grade.criteria.map((c) => `
      <tr>
        <td style="padding:8px 10px;border-top:1px solid #eee;vertical-align:top;font-weight:600;white-space:nowrap">${esc(c.name)}</td>
        <td style="padding:8px 10px;border-top:1px solid #eee;vertical-align:top;text-align:center;white-space:nowrap;color:${ORANGE};font-weight:700">${
    c.score == null ? "–" : `${esc(c.score)}/${esc(c.max)}`
  }</td>
        <td style="padding:8px 10px;border-top:1px solid #eee;vertical-align:top;color:#333">${esc(c.comment)}</td>
      </tr>`).join("");
  const h = (t: string) =>
    `<h3 style="margin:22px 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${ORANGE}">${esc(t)}</h3>`;
  const q = (e.question || "").trim();
  return `<!doctype html>
<html><body style="margin:0;background:#f4f1ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">
    <div style="background:${INK};color:#fff;border-radius:12px 12px 0 0;padding:18px 22px">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${ORANGE};font-weight:700">Preach · AI sermon feedback</div>
      <div style="font-size:22px;font-weight:800;margin-top:6px">${esc(e.sermonTitle)}</div>
      <div style="font-size:14px;color:#ddd;margin-top:4px">${esc(e.preacher)} · ${esc(e.date)}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:20px 22px">
      <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
        <td style="vertical-align:middle">
          <div style="font-size:13px;color:#555">Length</div>
          <div style="font-size:15px;font-weight:600">${esc(lengthLine(e.timing))}</div>
        </td>
        <td style="vertical-align:middle;text-align:right">
          <div style="display:inline-block;background:${ORANGE};color:#fff;border-radius:10px;padding:8px 16px;font-size:30px;font-weight:800" data-grade>${
    esc(e.grade.overall)
  }</div>
          ${e.grade.average != null ? `<div style="font-size:12px;color:#777;margin-top:4px">avg ${esc(e.grade.average)}/10</div>` : ""}
        </td>
      </tr></table>
      ${h("Summary")}
      <p style="margin:6px 0 0;line-height:1.5">${esc(e.summary)}</p>
      ${h("Grades")}
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.4">
        <tr style="background:#faf7f4"><th style="text-align:left;padding:8px 10px">Area</th><th style="padding:8px 10px">Score</th><th style="text-align:left;padding:8px 10px">Notes</th></tr>${rows}
      </table>
      ${h("Strengths")}${li(e.grade.strengths)}
      ${h("Growth areas")}${li(e.grade.growth_areas)}
      ${
    q
      ? `${h("Their question")}<p style="margin:6px 0 0;font-style:italic">“${esc(q)}”</p><p style="margin:8px 0 0;line-height:1.5">${
        esc(e.grade.answer_to_question)
      }</p>`
      : ""
  }
      <p style="margin:26px 0 4px"><a href="${
    esc(e.reviewUrl)
  }" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;border-radius:8px;padding:10px 18px;font-weight:700">Listen &amp; review in Preach →</a></p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">Generated automatically by Grok from the recording's transcript. Use it as a conversation starter, not a verdict.</p>
    </div>
  </div>
</body></html>`;
}
