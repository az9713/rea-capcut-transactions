(() => {
  // src/json.mjs
  var JSON_LIMITS = { bytes: 5 * 1024 * 1024, depth: 40, nodes: 2e5, string: 1e5 };
  var BAD = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var own = (o, k) => Object.hasOwn(o, k);
  var clone = (v) => structuredClone(v);
  function fail(message) {
    throw Error(message);
  }
  function checkedString(s, max = JSON_LIMITS.string) {
    if (typeof s !== "string" || s.length > max) fail("Invalid or oversized string.");
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const n = s.charCodeAt(++i);
        if (!(n >= 56320 && n <= 57343)) fail("Ill-formed Unicode rejected.");
      } else if (c >= 56320 && c <= 57343) fail("Ill-formed Unicode rejected.");
    }
    return s;
  }
  function parseJSON(text, limits = JSON_LIMITS) {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limits.bytes) fail("JSON input exceeds its byte limit.");
    let i = 0, nodes = 0;
    const whitespace = () => {
      while (/[\x20\n\r\t]/.test(text[i] ?? "!")) i++;
    };
    function string() {
      const start = i++;
      let closed = false;
      while (i < text.length) {
        const c = text[i++];
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) fail("Unterminated JSON string.");
      return checkedString(JSON.parse(text.slice(start, i)), limits.string);
    }
    function value(depth) {
      if (depth > limits.depth || ++nodes > limits.nodes) fail("JSON depth/node bound exceeded.");
      whitespace();
      const c = text[i];
      if (c === '"') return string();
      if (c === "{") {
        i++;
        whitespace();
        const out2 = /* @__PURE__ */ Object.create(null);
        if (text[i] === "}") {
          i++;
          return out2;
        }
        while (true) {
          whitespace();
          if (text[i] !== '"') fail("Expected JSON object key.");
          const key = string();
          if (BAD.has(key)) fail("Unsafe object key rejected.");
          if (own(out2, key)) fail("Duplicate object key rejected.");
          whitespace();
          if (text[i++] !== ":") fail("Expected JSON colon.");
          out2[key] = value(depth + 1);
          whitespace();
          if (text[i] === "}") {
            i++;
            return out2;
          }
          if (text[i++] !== ",") fail("Expected JSON object comma.");
        }
      }
      if (c === "[") {
        i++;
        whitespace();
        const out2 = [];
        if (text[i] === "]") {
          i++;
          return out2;
        }
        while (true) {
          out2.push(value(depth + 1));
          whitespace();
          if (text[i] === "]") {
            i++;
            return out2;
          }
          if (text[i++] !== ",") fail("Expected JSON array comma.");
        }
      }
      for (const [token, v] of [["true", true], ["false", false], ["null", null]]) if (text.startsWith(token, i)) {
        i += token.length;
        return v;
      }
      const match = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) fail("Invalid JSON value.");
      i += match[0].length;
      const number = Number(match[0]);
      if (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number) || Object.is(number, -0)) fail("Unsafe/nonfinite/negative-zero number rejected.");
      return number;
    }
    const out = value(0);
    whitespace();
    if (i !== text.length) fail("Trailing JSON data rejected.");
    return out;
  }
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (object(v)) return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }
  async function hash(v) {
    const bytes = new TextEncoder().encode(canonical(v));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function keysExactly(value, keys) {
    if (!object(value) || Object.keys(value).some((k) => !keys.includes(k)) || keys.some((k) => !own(value, k))) fail("Unsupported fields or incomplete transaction shape.");
  }

  // src/core.mjs
  var FORMAT = "caption-transaction-project";
  var MANIFEST = "caption-transaction-manifest";
  var LIMITS = { draftBytes: 1024 * 1024, draftDepth: 30, draftNodes: 4e4, texts: 1e3, segments: 5e3, tracks: 100, history: 20, targets: 500, matches: 1e4, text: 2e4 };
  var HASH = /^[a-f\d]{64}$/;
  var INNER_KEYS = /* @__PURE__ */ new Set(["text", "styles", "layer_weight", "effect"]);
  var STYLE_KEYS = /* @__PURE__ */ new Set(["range", "fill", "font", "size", "bold", "italic", "underline", "strokes", "shadows", "effectStyle"]);
  var MIXED = /* @__PURE__ */ new Set(["runs", "rich_text", "words", "word_ranges", "paragraphs", "text_info_resources", "segments", "text_templates", "ranges"]);
  function validId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= 160 && !/[\x00-\x1f]/.test(id);
  }
  function timerange(value) {
    return object(value) && Number.isSafeInteger(value.start) && value.start >= 0 && Number.isSafeInteger(value.duration) && value.duration >= 0 && Number.isSafeInteger(value.start + value.duration);
  }
  function validateDraft(draft2) {
    const safe = parseJSON(JSON.stringify(draft2), { ...JSON_LIMITS, bytes: LIMITS.draftBytes, depth: LIMITS.draftDepth, nodes: LIMITS.draftNodes });
    if (!object(safe) || !object(safe.materials) || !Array.isArray(safe.materials.texts) || !Array.isArray(safe.tracks)) fail("Supported plaintext draft requires materials.texts and tracks arrays. No encrypted/project-folder conversion.");
    if (safe.materials.texts.length > LIMITS.texts || safe.tracks.length > LIMITS.tracks) fail("Draft text/track resource bound exceeded.");
    const ids = /* @__PURE__ */ new Set();
    for (const [category, items] of Object.entries(safe.materials)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!object(item) || !own(item, "id")) continue;
        if (!validId(item.id) || ids.has(item.id)) fail("Invalid or ambiguous duplicate material ID.");
        ids.add(item.id);
      }
    }
    for (const item of safe.materials.texts) if (!object(item) || !validId(item.id)) fail("Every text material needs a unique bounded ID.");
    let segments = 0;
    const trackIds = /* @__PURE__ */ new Set(), segmentIds = /* @__PURE__ */ new Set();
    for (const track of safe.tracks) {
      if (!object(track) || !validId(track.id) || trackIds.has(track.id) || !Array.isArray(track.segments)) fail("Invalid/duplicate track or segment array.");
      trackIds.add(track.id);
      for (const segment2 of track.segments) {
        if (++segments > LIMITS.segments) fail("Segment resource bound exceeded.");
        if (!object(segment2) || !validId(segment2.id) || segmentIds.has(segment2.id) || !validId(segment2.material_id) || !timerange(segment2.target_timerange)) fail("Invalid/duplicate segment reference or target timing.");
        segmentIds.add(segment2.id);
        if (segment2.source_timerange !== void 0 && segment2.source_timerange !== null && !timerange(segment2.source_timerange)) fail("Unsupported source timing shape.");
      }
    }
    return safe;
  }
  function boundary(text, index) {
    if (index <= 0 || index >= text.length) return true;
    const previous = text.charCodeAt(index - 1), next = text.charCodeAt(index);
    return !(previous >= 55296 && previous <= 56319 && next >= 56320 && next <= 57343);
  }
  function classify(material2) {
    if (!["text", "subtitle"].includes(material2.type) || typeof material2.content !== "string") return { supported: false, reason: "Only text/subtitle materials with JSON-encoded content are editable." };
    let inner;
    try {
      inner = parseJSON(material2.content);
    } catch {
      return { supported: false, reason: "Embedded text JSON is unreadable/unsafe; raw content is preserved opaque." };
    }
    if (!object(inner) || typeof inner.text !== "string" || inner.text.length > LIMITS.text || !Array.isArray(inner.styles) || !inner.styles.length || inner.styles.length > 200) return { supported: false, reason: "Expected a bounded plain text + nonempty styles payload; other rich objects remain opaque." };
    if (Object.keys(inner).some((k) => MIXED.has(k))) return { supported: false, reason: "Mixed text/runs/word-cache payload is unsupported; no silent flattening.", text: inner.text };
    let ranges = [];
    for (let i = 0; i < inner.styles.length; i++) {
      const s = inner.styles[i], r = s?.range;
      if (!object(s) || !Array.isArray(r) || r.length !== 2 || !r.every(Number.isSafeInteger) || r[0] < 0 || r[1] < r[0] || r[1] > inner.text.length || !boundary(inner.text, r[0]) || !boundary(inner.text, r[1])) return { supported: false, reason: "Style ranges are not valid UTF-16 code-unit boundaries; no byte/codepoint guessing or repair.", text: inner.text };
      ranges.push({ start: r[0], end: r[1], styleIndex: i });
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    let cursor = 0;
    for (const r of ranges) {
      if (r.start !== cursor || r.end === r.start && inner.text.length) return { supported: false, reason: "Overlapping/gapped/empty style spans are outside the supported partition contract.", text: inner.text };
      cursor = r.end;
    }
    if (cursor !== inner.text.length) return { supported: false, reason: "Style partition does not cover the whole text.", text: inner.text };
    const unknown = Object.keys(inner).filter((k) => !INNER_KEYS.has(k));
    const unknownStyle = inner.styles.some((s) => Object.keys(s).some((k) => !STYLE_KEYS.has(k)));
    const extraEffect = own(inner, "effect") && (!Array.isArray(inner.effect) || inner.effect.length > 0);
    const unsafeNested = (v) => {
      if (Array.isArray(v)) return v.some(unsafeNested);
      if (object(v)) return Object.entries(v).some(([k, x]) => /^(?:ranges?|start|end|offset|length|text|words|start_index|end_index)$/.test(k) || unsafeNested(x));
      return false;
    };
    const nestedPosition = inner.styles.some((s) => Object.entries(s).some(([k, v]) => k !== "range" && unsafeNested(v)));
    return { supported: true, inner, text: inner.text, ranges, canAdjust: !unknown.length && !unknownStyle && !extraEffect && !nestedPosition, reason: unknown.length || unknownStyle || extraEffect || nestedPosition ? "Same-length replacements only: unknown rich fields/effects may carry additional offsets." : "Validated plain text/style partition; boundary-safe range adjustment available." };
  }
  function inventory(draft2) {
    const uses = /* @__PURE__ */ new Map();
    for (const track of draft2.tracks) for (const segment2 of track.segments) {
      const list = uses.get(segment2.material_id) ?? [];
      list.push({ trackId: track.id, trackType: typeof track.type === "string" ? track.type : "unknown", segmentId: segment2.id, start: segment2.target_timerange.start, duration: segment2.target_timerange.duration });
      uses.set(segment2.material_id, list);
    }
    return draft2.materials.texts.map((material2, index) => ({ id: material2.id, index, type: material2.type, ...classify(material2), uses: uses.get(material2.id) ?? [] }));
  }
  function checkRule(rule2) {
    keysExactly(rule2, ["from", "to", "policy"]);
    checkedString(rule2.from, 200);
    checkedString(rule2.to, 2e3);
    if (!rule2.from.length || rule2.from === rule2.to) fail("Use a nonempty literal search and a different replacement.");
    if (!["preserve-offsets", "adjust-known-ranges"].includes(rule2.policy)) fail("Unsupported range policy.");
    if (rule2.policy === "preserve-offsets" && rule2.from.length !== rule2.to.length) fail("Preserve-offsets policy requires equal UTF-16 lengths. Choose explicit known-range adjustment or use an equal-length correction.");
  }
  function occurrences(text, from) {
    const found = [];
    for (let i = text.indexOf(from); i >= 0; i = text.indexOf(from, i + from.length)) {
      if (!boundary(text, i) || !boundary(text, i + from.length)) fail("Match splits a UTF-16 surrogate pair.");
      found.push({ start: i, end: i + from.length });
      if (found.length > LIMITS.matches) fail("Literal match resource bound exceeded.");
    }
    return found;
  }
  function transform(row, rule2) {
    if (!row.supported) fail(`${row.id}: ${row.reason}`);
    const matches = occurrences(row.text, rule2.from);
    if (!matches.length) return null;
    const delta = rule2.to.length - rule2.from.length;
    if (delta && (!row.canAdjust || rule2.policy !== "adjust-known-ranges")) fail(`${row.id}: length-changing replacement is refused for unknown rich fields/effects.`);
    if (delta) {
      for (const r of row.ranges) for (const p of [r.start, r.end]) if (matches.some((m) => m.start < p && p < m.end)) fail(`${row.id}: replacement crosses a style boundary; no proportional redistribution.`);
    }
    let result = "", cursor = 0;
    for (const m of matches) {
      result += row.text.slice(cursor, m.start) + rule2.to;
      cursor = m.end;
    }
    result += row.text.slice(cursor);
    if (!result.length || result.length > LIMITS.text) fail("Empty/oversized replacement result is outside the supported text contract.");
    const next = clone(row.inner);
    next.text = result;
    function map(p) {
      let shift = 0;
      for (const m of matches) {
        if (p <= m.start) return p + shift;
        if (p < m.end) fail("Ambiguous style endpoint inside replacement.");
        shift += delta;
      }
      return p + shift;
    }
    const rangeDiff = [];
    for (let i = 0; i < next.styles.length; i++) {
      const old = next.styles[i].range;
      const updated = delta ? [map(old[0]), map(old[1])] : [...old];
      if (updated[1] <= updated[0]) fail("Replacement would collapse a style span; refuse instead of deleting formatting.");
      if (!boundary(result, updated[0]) || !boundary(result, updated[1])) fail("Mapped style range would split a surrogate pair.");
      next.styles[i].range = updated;
      rangeDiff.push({ styleIndex: i, before: [...old], after: updated });
    }
    return { inner: next, text: result, matches, rangeDiff };
  }
  function eligible(row, rule2) {
    try {
      checkRule(rule2);
      const result = transform(row, rule2);
      return result ? { ok: true, count: result.matches.length } : { ok: false, reason: "No literal match." };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }
  function protectedView(draft2) {
    const value = clone(draft2);
    for (const text of value.materials.texts) if (own(text, "content")) text.content = { preservedTextSlot: true };
    return value;
  }
  function styleView(inner) {
    const value = clone(inner);
    value.text = "<text>";
    for (const style2 of value.styles) style2.range = ["<start>", "<end>"];
    return value;
  }
  function mediaView(draft2) {
    const value = clone(draft2.materials);
    delete value.texts;
    return value;
  }
  async function makePlan(draft2, ids, rule2) {
    checkRule(rule2);
    if (!Array.isArray(ids) || !ids.length || ids.length > LIMITS.targets || new Set(ids).size !== ids.length) fail("Choose1\u2013500 unique material IDs.");
    const rows = new Map(inventory(draft2).map((r) => [r.id, r]));
    const targets = [];
    for (const id of [...ids].sort()) {
      const row = rows.get(id);
      if (!row) fail("Target text material not found.");
      transform(row, rule2);
      targets.push({ id, materialHash: await hash(draft2.materials.texts[row.index]) });
    }
    return { baseHash: await hash(draft2), rule: clone(rule2), targets };
  }
  async function applyPlan(draft2, plan) {
    keysExactly(plan, ["baseHash", "rule", "targets"]);
    checkRule(plan.rule);
    const before = validateDraft(draft2);
    if (!HASH.test(plan.baseHash) || await hash(before) !== plan.baseHash) fail("Exact baseline/current checkpoint mismatch.");
    if (!Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length > LIMITS.targets) fail("Target count bound exceeded.");
    const rows = new Map(inventory(before).map((r) => [r.id, r])), seen = /* @__PURE__ */ new Set(), next = clone(before), diff = [];
    let total = 0;
    for (const target of plan.targets) {
      keysExactly(target, ["id", "materialHash"]);
      if (seen.has(target.id) || !rows.has(target.id)) fail("Ambiguous duplicate/missing target ID.");
      seen.add(target.id);
      const row = rows.get(target.id), material2 = before.materials.texts[row.index];
      if (!HASH.test(target.materialHash) || await hash(material2) !== target.materialHash) fail("Stale text-material guard.");
      const changed = transform(row, plan.rule);
      if (!changed) continue;
      if ((total += changed.matches.length) > LIMITS.matches) fail("Total match resource bound exceeded.");
      if (canonical(styleView(row.inner)) !== canonical(styleView(changed.inner))) fail("Style/unknown rich-field invariant failed.");
      const content = JSON.stringify(changed.inner);
      next.materials.texts[row.index].content = content;
      diff.push({ id: row.id, occurrences: changed.matches.length, uses: clone(row.uses), beforeText: row.text, afterText: changed.text, beforeContent: material2.content, afterContent: content, ranges: changed.rangeDiff, styleHash: await hash(styleView(row.inner)) });
    }
    if (!diff.length) fail("No matching text changes; no-op transaction refused.");
    validateDraft(next);
    const protectedHash = await hash(protectedView(before)), tracksHash = await hash(before.tracks), mediaHash = await hash(mediaView(before));
    if (protectedHash !== await hash(protectedView(next)) || tracksHash !== await hash(next.tracks) || mediaHash !== await hash(mediaView(next))) fail("Timing/reference/media/unknown-field invariant failed.");
    diff.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { document: next, beforeHash: plan.baseHash, afterHash: await hash(next), diff, invariants: { protectedHash, tracksHash, mediaHash, styles: diff.map((d) => ({ id: d.id, styleHash: d.styleHash })), tracksAndReferencesUnchanged: true, nonTextMaterialsUnchanged: true, unknownAndStyleFieldsPreserved: true } };
  }
  async function createProject(draft2) {
    const baseline = validateDraft(draft2), baselineHash = await hash(baseline);
    return { format: FORMAT, version: 1, baseline, baselineHash, history: [], cursor: 0, checkpoint: baselineHash };
  }
  function budget(project2) {
    parseJSON(JSON.stringify(project2));
    if (new TextEncoder().encode(JSON.stringify(project2.history)).byteLength > 2 * 1024 * 1024) fail("History exceeds2 MiB; export current draft as a separate baseline.");
  }
  async function replayHistory(baseline, history2, cursor = history2.length) {
    if (!Array.isArray(history2) || history2.length > LIMITS.history || !Number.isInteger(cursor) || cursor < 0 || cursor > history2.length) fail("Invalid history/cursor bounds.");
    let draft2 = validateDraft(baseline), selected2 = clone(draft2);
    for (let i = 0; i < history2.length; i++) {
      const record = history2[i];
      keysExactly(record, ["sequence", "label", "plan", "beforeHash", "afterHash", "diff", "invariants", "recordHash"]);
      checkedString(record.label, 160);
      if (!record.label.trim() || record.sequence !== i + 1) fail("Invalid transaction label/sequence.");
      const { recordHash, ...body } = record;
      if (!HASH.test(recordHash) || await hash(body) !== recordHash) fail("Transaction record SHA mismatch.");
      const applied = await applyPlan(draft2, record.plan);
      if (applied.beforeHash !== record.beforeHash || applied.afterHash !== record.afterHash || canonical(applied.diff) !== canonical(record.diff) || canonical(applied.invariants) !== canonical(record.invariants)) fail("Replay result/differential/invariant mismatch.");
      draft2 = applied.document;
      if (i + 1 === cursor) selected2 = clone(draft2);
    }
    return selected2;
  }
  async function verifyProject(project2) {
    keysExactly(project2, ["format", "version", "baseline", "baselineHash", "history", "cursor", "checkpoint"]);
    if (project2.format !== FORMAT || project2.version !== 1) fail("Unsupported native project format.");
    budget(project2);
    const base = validateDraft(project2.baseline);
    if (await hash(base) !== project2.baselineHash) fail("Exact original baseline hash mismatch.");
    const document2 = await replayHistory(base, project2.history, project2.cursor);
    if (await hash(document2) !== project2.checkpoint) fail("Current checkpoint mismatch.");
    return { project: clone(project2), document: document2 };
  }
  async function commit(project2, label, plan) {
    checkedString(label, 160);
    if (!label.trim()) fail("Name the transaction.");
    const verified = await verifyProject(project2), applied = await applyPlan(verified.document, plan), next = clone(project2);
    next.history = next.history.slice(0, next.cursor);
    if (next.history.length >= LIMITS.history) fail("History limit20 reached. Start a separate baseline.");
    const body = { sequence: next.history.length + 1, label, plan: clone(plan), beforeHash: applied.beforeHash, afterHash: applied.afterHash, diff: applied.diff, invariants: applied.invariants };
    next.history.push({ ...body, recordHash: await hash(body) });
    next.cursor = next.history.length;
    next.checkpoint = applied.afterHash;
    budget(next);
    return { project: next, document: applied.document };
  }
  async function setCursor(project2, cursor) {
    await verifyProject(project2);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > project2.history.length) fail("Undo/redo cursor out of range.");
    const next = clone(project2);
    next.cursor = cursor;
    next.checkpoint = cursor ? next.history[cursor - 1].afterHash : next.baselineHash;
    return { project: next, document: await replayHistory(next.baseline, next.history, cursor) };
  }
  var nativeJSON = (p) => JSON.stringify(p) + "\n";
  var draftJSON = (d) => JSON.stringify(d) + "\n";
  async function exportManifest(project2) {
    await verifyProject(project2);
    const body = { format: MANIFEST, version: 1, baselineHash: project2.baselineHash, history: clone(project2.history), cursor: project2.cursor, checkpoint: project2.checkpoint };
    return { ...body, manifestHash: await hash(body) };
  }
  async function replayManifest(baseline, input) {
    keysExactly(input, ["format", "version", "baselineHash", "history", "cursor", "checkpoint", "manifestHash"]);
    if (input.format !== MANIFEST || input.version !== 1) fail("Unsupported manifest.");
    const { manifestHash, ...body } = input;
    if (!HASH.test(manifestHash) || await hash(body) !== manifestHash) fail("Manifest SHA mismatch.");
    return verifyProject({ format: FORMAT, version: 1, baseline: validateDraft(baseline), baselineHash: input.baselineHash, history: clone(input.history), cursor: input.cursor, checkpoint: input.checkpoint });
  }
  async function importText(text) {
    const data = parseJSON(text);
    if (object(data) && data.format === FORMAT) return verifyProject(data);
    const project2 = await createProject(data);
    return { project: project2, document: clone(project2.baseline) };
  }

  // src/fixture.mjs
  var style = (start, end, extra = {}) => ({ range: [start, end], size: 18, bold: false, italic: false, underline: false, fill: { content: { solid: { color: [0.87, 0.94, 0.96] } } }, ...extra });
  var material = (id, text, styles, extra = {}) => ({ id, type: "text", content: JSON.stringify({ text, styles: styles ?? [style(0, text.length)], layer_weight: 1, effect: [] }), font_name: "Synthetic sans serif", text_alignment: 1, metadata: { synthetic: true }, ...extra });
  var segment = (id, material_id, start, duration, extra = {}) => ({ id, material_id, target_timerange: { start, duration }, source_timerange: null, speed: 1, extra_material_refs: [], render_index: 0, clip: { alpha: 1, transform: { x: 0, y: -0.7 } }, ...extra });
  var rich = "Two Qbit states interfere.";
  var cached = { text: "Qbit vocabulary persists.", styles: [style(0, 25)], future_cache: { token: "Qbit", preserve: true } };
  cached.styles[0].range[1] = cached.text.length;
  var fixture = { id: "synthetic-research-draft", duration: 24e6, fps: 30, canvas_config: { width: 1920, height: 1080, ratio: "original" }, synthetic_fixture: true, future_root: { keep: ["all", "unknown", "fields"] }, materials: {
    texts: [material("caption-a", "The Qbit retains phase."), material("caption-b", rich, [style(0, 4), style(4, 8, { bold: true }), style(8, rich.length)]), material("caption-shared", "Qbit and Qbit are linked."), material("caption-cached", cached.text, null, { content: JSON.stringify(cached), future_outer: { preserve: "metadata" } }), material("caption-mixed", "Qbit rich object", null, { content: JSON.stringify({ text: "Qbit rich object", styles: [style(0, 16)], runs: [{ text: "Qbit", range: [0, 4] }] }) }), { id: "caption-legacy", type: "text", content: "Opaque legacy Qbit string", future_raw: true }],
    videos: [{ id: "video-main", type: "video", path: "synthetic://never-loaded-video", duration: 32e6, width: 1920, height: 1080, future_video: { keep: true } }],
    audios: [{ id: "audio-main", type: "extract_music", path: "synthetic://never-loaded-audio", duration: 24e6, wave_points: [] }],
    speeds: [{ id: "speed-curve", type: "speed", speed: 1.25, curve_speed: { points: [{ x: 0, y: 1 }, { x: 1, y: 1.25 }] } }],
    text_templates: [{ id: "opaque-template", type: "text_template", text_info_resources: [{ text_material_id: "caption-mixed" }], future_layout: true }],
    future_materials: [{ id: "future-mat", type: "future", payload: { keep: true } }]
  }, tracks: [
    { id: "video-track", name: "Synthetic source", type: "video", segments: [segment("video-seg", "video-main", 0, 24e6, { source_timerange: { start: 1e6, duration: 3e7 }, speed: 1.25, extra_material_refs: ["speed-curve"], future_motion: { keep: true } })] },
    { id: "captions-track", name: "Scientific captions", type: "text", segments: [segment("caption-seg-a", "caption-a", 5e5, 35e5), segment("caption-seg-b", "caption-b", 45e5, 35e5), segment("caption-seg-shared-1", "caption-shared", 85e5, 35e5), segment("caption-seg-cached", "caption-cached", 125e5, 35e5), segment("caption-seg-shared-2", "caption-shared", 17e6, 35e5)] },
    { id: "titles-track", name: "Opaque title constructs", type: "text", segments: [segment("mixed-title", "caption-mixed", 0, 24e5), segment("legacy-title", "caption-legacy", 21e6, 25e5)] },
    { id: "audio-track", name: "Synthetic narration", type: "audio", segments: [segment("audio-seg", "audio-main", 0, 24e6, { source_timerange: { start: 0, duration: 24e6 }, volume: 0.75, extra_material_refs: [] })] }
  ] };

  // src/app.mjs
  var $ = (s) => document.querySelector(s);
  var el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== void 0) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  var project;
  var draft;
  var preview = null;
  var selected = /* @__PURE__ */ new Set();
  var saved;
  var busy = false;
  var revision = 0;
  var rule = () => ({ from: $("#from").value, to: $("#to").value, policy: $("#policy").value });
  var notice = (message, error = false) => {
    $("#notice").textContent = message;
    $("#notice").className = error ? "notice error" : "notice";
  };
  async function run(fn) {
    if (busy) return;
    busy = true;
    document.body.classList.add("busy");
    try {
      await fn();
    } catch (error) {
      notice(error.message, true);
    } finally {
      busy = false;
      document.body.classList.remove("busy");
    }
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = el("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  }
  function chooseEligible() {
    revision++;
    selected = new Set(inventory(draft).filter((r) => eligible(r, rule()).ok).map((r) => r.id));
    preview = null;
  }
  function timeline() {
    const root = $("#timeline");
    root.replaceChildren();
    const rows = new Map(inventory(draft).map((r) => [r.id, r]));
    let end = 1;
    for (const t of draft.tracks) for (const s of t.segments) end = Math.max(end, s.target_timerange.start + s.target_timerange.duration);
    $("#timeline-duration").textContent = `${(end / 1e6).toFixed(1)} seconds \xB7 target times in microseconds`;
    const changed = new Set(preview?.result.diff.map((d) => d.id) ?? []);
    for (const track of draft.tracks) {
      const row = el("div", void 0, "timeline-row");
      const label = el("div", void 0, "track-label");
      label.append(el("strong", typeof track.name === "string" ? track.name : track.id), el("span", typeof track.type === "string" ? track.type : "unknown"));
      const lane = el("div", void 0, "track-lane");
      for (const segment2 of track.segments) {
        const m = rows.get(segment2.material_id), bar = el("button", m?.text?.slice(0, 75) ?? `[${segment2.material_id}]`, `clip ${m ? "text-clip" : "media-clip"} ${changed.has(segment2.material_id) ? "changed" : ""}`);
        bar.style.left = `${100 * segment2.target_timerange.start / end}%`;
        bar.style.width = `${Math.max(0.5, 100 * segment2.target_timerange.duration / end)}%`;
        bar.title = `${segment2.id} \xB7 ${segment2.target_timerange.start}\u2013${segment2.target_timerange.start + segment2.target_timerange.duration} \xB5s`;
        bar.onclick = () => {
          if (m) {
            $("#materials").scrollIntoView({ behavior: "smooth" });
            notice(`Material ${m.id} is shared by ${m.uses.length} segment(s). Replacement is material-wide; timing remains unchanged.`);
          }
        };
        lane.append(bar);
      }
      row.append(label, lane);
      root.append(row);
    }
  }
  function materials() {
    const root = $("#material-list");
    root.replaceChildren();
    for (const row of inventory(draft)) {
      const availability = eligible(row, rule()), card = el("div", void 0, `material ${row.supported ? "" : "opaque"}`);
      const label = el("label", void 0, "material-choice"), check = el("input");
      check.type = "checkbox";
      check.dataset.material = row.id;
      check.checked = selected.has(row.id);
      check.onchange = () => {
        revision++;
        if (check.checked) selected.add(row.id);
        else selected.delete(row.id);
        preview = null;
        render();
      };
      label.append(check, el("code", row.id), el("span", `${row.uses.length} use${row.uses.length === 1 ? "" : "s"}`, "use-badge"));
      card.append(label, el("p", typeof row.text === "string" ? row.text : "[Opaque encoded/raw content]", "caption-text"), el("p", availability.ok ? `${availability.count} literal match(es) \xB7 ${row.inner.styles.length} style span(s)` : availability.reason ?? row.reason, availability.ok ? "eligible" : "warning"));
      const details = el("details");
      details.append(el("summary", "Source encoding / ranges / segment references"), el("pre", JSON.stringify({ status: row.supported ? "parsed" : "opaque", canAdjust: row.canAdjust ?? false, reason: row.reason, ranges: row.ranges, uses: row.uses, content: draft.materials.texts[row.index].content }, null, 2)));
      card.append(details);
      root.append(card);
    }
  }
  function diffs() {
    const root = $("#diff");
    root.replaceChildren();
    if (!preview) {
      root.append(el("p", "Choose materials, review a literal rule and preview the entire atomic transaction. No changes have been applied.", "muted"));
      return;
    }
    for (const d of preview.result.diff) {
      const card = el("article", void 0, "diff-card");
      card.append(el("h3", d.id), el("span", `${d.occurrences} occurrence(s) \xB7 ${d.uses.length} segment use(s)`, "eyebrow"));
      const pair = el("div", void 0, "before-after");
      const left = el("div"), right = el("div");
      left.append(el("small", "BEFORE"), el("p", d.beforeText));
      right.append(el("small", "AFTER"), el("p", d.afterText));
      pair.append(left, right);
      card.append(pair);
      const ranges = el("pre", JSON.stringify(d.ranges, null, 2));
      const details = el("details");
      details.append(el("summary", "Exact style-range differential (UTF-16 code units)"), ranges);
      card.append(details);
      root.append(card);
    }
    const proof = el("details");
    proof.append(el("summary", "Protected-field invariant witness"), el("pre", JSON.stringify(preview.result.invariants, null, 2)));
    root.append(proof);
  }
  function history() {
    const root = $("#history");
    root.replaceChildren();
    for (const record of project.history) {
      const card = el("div", void 0, `history-item ${record.sequence > project.cursor ? "inactive" : ""}`);
      card.append(el("strong", `${record.sequence}. ${record.label}`), el("small", `${record.diff.length} changed materials \xB7 ${record.plan.rule.policy}`), el("code", record.recordHash));
      const details = el("details");
      details.append(el("summary", "Transaction + invariant receipt"), el("pre", JSON.stringify({ rule: record.plan.rule, invariants: record.invariants, diff: record.diff }, null, 2)));
      card.append(details);
      root.append(card);
    }
    if (!project.history.length) root.append(el("p", "No committed caption transactions yet.", "muted"));
  }
  function render() {
    const rows = inventory(draft);
    $("#material-count").textContent = String(rows.length);
    $("#opaque-count").textContent = String(rows.filter((r) => !r.supported).length);
    $("#changed-count").textContent = String(preview?.result.diff.length ?? 0);
    $("#checkpoint").textContent = project.checkpoint;
    $("#cursor").textContent = `${project.cursor}/${project.history.length}`;
    $("#undo").disabled = project.cursor === 0 || !!preview;
    $("#redo").disabled = project.cursor === project.history.length || !!preview;
    $("#apply").disabled = !preview;
    $("#dirty").textContent = nativeJSON(project) === saved ? "Saved/imported project" : "Unsaved native history/cursor";
    timeline();
    materials();
    diffs();
    history();
  }
  async function install(result, message) {
    if (project && (nativeJSON(project) !== saved || preview) && !confirm("Replace the current workbench? Save a native project first; pending previews are not durable.")) return;
    project = result.project;
    draft = result.document;
    preview = null;
    saved = nativeJSON(project);
    chooseEligible();
    notice(message);
    render();
  }
  for (const id of ["#from", "#to", "#policy"]) $(id).oninput = () => {
    revision++;
    preview = null;
    notice("Rule changed. Selections are retained; use Select eligible matches or explicitly include/refuse targets.");
    render();
  };
  $("#select-eligible").onclick = () => {
    chooseEligible();
    notice("Selected only eligible literal matches for this explicit rule. Opaque/ineligible materials remain visible and unselected.");
    render();
  };
  $("#preview").onclick = () => run(async () => {
    const generation = revision, current = draft, plan = await makePlan(current, [...selected], rule()), result = await applyPlan(current, plan);
    if (generation !== revision) {
      notice("Inputs changed during validation; stale preview discarded. Preview the current rule again.");
      return;
    }
    preview = { plan, result };
    notice("Atomic preview ready. Checkpoints, every track, speed/reference field, non-text material and style payload are preserved by the invariant witness.");
    render();
  });
  $("#discard").onclick = () => {
    revision++;
    preview = null;
    notice("Preview discarded. The committed draft is unchanged.");
    render();
  };
  $("#apply").onclick = () => run(async () => {
    if (!preview) return;
    if (project.cursor < project.history.length && !confirm("Applying after undo replaces the redo branch. Save a project first to preserve it.")) return;
    const result = await commit(project, $("#label").value, preview.plan);
    project = result.project;
    draft = result.document;
    preview = null;
    chooseEligible();
    notice("Caption transaction committed. Native project and replay manifest retain the original baseline and the exact differential.");
    render();
  });
  for (const [id, delta] of [["#undo", -1], ["#redo", 1]]) $(id).onclick = () => run(async () => {
    if (preview) throw Error("Discard/apply the preview before undo/redo.");
    const result = await setCursor(project, project.cursor + delta);
    project = result.project;
    draft = result.document;
    chooseEligible();
    notice(delta < 0 ? "Undo replayed the exact earlier checkpoint." : "Redo replayed the exact later checkpoint.");
    render();
  });
  $("#save-project").onclick = () => run(async () => {
    await verifyProject(project);
    const text = nativeJSON(project);
    download("captions.captionwork.json", text);
    saved = text;
    notice("Native baseline/history/cursor/redo project saved. Unapplied preview is excluded.");
    render();
  });
  $("#export-draft").onclick = () => {
    download("draft_content.candidate.json", draftJSON(draft));
    notice("Exported a separate committed draft JSON candidate. No source file was overwritten; native CapCut reopen/render remains unverified.");
  };
  $("#export-baseline").onclick = () => download("draft_content.original.json", draftJSON(project.baseline));
  $("#export-manifest").onclick = () => run(async () => download("captions.transactions.json", JSON.stringify(await exportManifest(project)) + "\n"));
  $("#export-diff").onclick = () => {
    if (preview) download("caption-preview-receipt.json", JSON.stringify({ plan: preview.plan, diff: preview.result.diff, invariants: preview.result.invariants }, null, 2));
    else notice("Preview a replacement before saving its differential.", true);
  };
  $("#open-file").onchange = (event) => run(async () => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("Input exceeds5 MiB.");
      await install(await importText(await file.text()), "Imported plaintext locally; native projects were fully replayed and verified.");
    } finally {
      event.target.value = "";
    }
  });
  $("#import-pasted").onclick = () => run(async () => install(await importText($("#input-json").value), "Draft JSON imported without loading any media/font path."));
  $("#replay-file").onchange = (event) => run(async () => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("Manifest exceeds5 MiB.");
      await install(await replayManifest(project.baseline, parseJSON(await file.text())), "Transaction manifest replayed against the exact original baseline.");
    } finally {
      event.target.value = "";
    }
  });
  $("#load-demo").onclick = () => run(async () => {
    const p = await createProject(fixture);
    await install({ project: p, document: clone(p.baseline) }, "Synthetic draft loaded. No real CapCut project or runtime was accessed.");
  });
  window.addEventListener("beforeunload", (event) => {
    if (project && (nativeJSON(project) !== saved || preview)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  run(async () => {
    project = await createProject(fixture);
    draft = clone(project.baseline);
    saved = nativeJSON(project);
    chooseEligible();
    render();
  });
})();
