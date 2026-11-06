/**
 * `codex exec --output-schema` uses OpenAI's strict mode: every object is closed
 * and lists all its properties in `required`, so an optional property is a
 * required one that accepts null. `toStrictSchema` writes the schema that way and
 * `withoutOptionalNulls` takes those nulls out of the answer, so the station's own
 * schema validates it as it does with any other engine.
 */

type Schema = Record<string, unknown>;

const NULL = { type: "null" };
const KEPT = ["type", "const", "enum", "description", "title", "multipleOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems"];
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
/** Dropping these would change what the schema means, not only how tight it is. */
const REFUSED = ["allOf", "prefixItems"];

const isRecord = (v: unknown): v is Schema => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: object, key: string) => Object.hasOwn(o, key);
const at = (path: string, key: string) => (path ? `${path}.${key}` : key);

function refuse(path: string, reason: string): never {
  throw new Error(`este esquema no se puede usar con codex: en \`${path || "la raíz"}\`, ${reason}`);
}

function typesOf(s: Schema): string[] | undefined {
  if (typeof s.type === "string") return [s.type];
  return Array.isArray(s.type) ? s.type.filter((t): t is string => typeof t === "string") : undefined;
}

/** Only references strict mode can follow, and only to what the schema defines. */
function resolveRef(root: Schema, ref: string): unknown {
  if (ref === "#") return root;
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
  if (!match) return undefined;
  const defs = root[match[1]!];
  const name = match[2]!.replaceAll("~1", "/").replaceAll("~0", "~");
  return isRecord(defs) && has(defs, name) ? defs[name] : undefined;
}

const alternativesOf = (s: Schema): unknown[] | undefined => (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : undefined);

function hasType(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "integer":
      return Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

/**
 * Whether a value has the shape of this (original) schema's strict form: types,
 * literals and keys, with every property present and null allowed on optional ones.
 * `seen` stops references that lead back to themselves without consuming the value.
 */
function fits(node: unknown, value: unknown, root: Schema, seen: ReadonlySet<string> = new Set()): boolean {
  if (!isRecord(node)) return false;
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return false;
    return fits(resolveRef(root, node.$ref), value, root, new Set(seen).add(node.$ref));
  }
  const alternatives = alternativesOf(node);
  if (alternatives) return alternatives.some((a) => fits(a, value, root, seen));
  if (has(node, "const") && node.const !== value) return false;
  if (Array.isArray(node.enum) && !node.enum.includes(value)) return false;
  const types = typesOf(node);
  if (types && !types.some((t) => hasType(t, value))) return false;
  if (Array.isArray(value)) return !isRecord(node.items) || value.every((v) => fits(node.items, v, root));
  if (!isRecord(value)) return true;
  const properties = isRecord(node.properties) ? node.properties : {};
  const required = Array.isArray(node.required) ? node.required : [];
  return (
    Object.keys(value).every((k) => has(properties, k)) &&
    Object.keys(properties).every((k) => has(value, k) && ((value[k] === null && !required.includes(k)) || fits(properties[k], value[k], root)))
  );
}

/** A schema with no `type` of its own still needs one in strict mode: its literals say which. */
function literalType(literals: unknown[]): string | string[] {
  const types = [...new Set(literals.map((v) => (v === null ? "null" : typeof v)))];
  return types.length === 1 ? types[0]! : types;
}

/** The single way an optional property becomes nullable. `original` is its schema before conversion. */
function nullable(original: unknown, strict: Schema, root: Schema): Schema {
  if (fits(original, null, root)) return strict;
  if (Array.isArray(strict.anyOf)) return { ...strict, anyOf: [...strict.anyOf, NULL] };
  const { description, ...inner } = strict;
  return { anyOf: [inner, NULL], ...(description !== undefined && { description }) };
}

function strictObject(s: Schema, path: string, root: Schema): Schema {
  const properties = isRecord(s.properties) ? s.properties : {};
  const names = Object.keys(properties);
  const extra = s.additionalProperties;
  if (isRecord(extra) && Object.keys(extra).length) refuse(path, "tiene claves libres (additionalProperties con un esquema)");
  if (!names.length && extra !== false) refuse(path, "es un objeto abierto sin properties");
  const required = Array.isArray(s.required) ? s.required : [];
  return {
    properties: Object.fromEntries(
      names.map((name) => {
        const strict = strictNode(properties[name], at(path, name), root);
        return [name, required.includes(name) ? strict : nullable(properties[name], strict, root)];
      }),
    ),
    required: names,
    additionalProperties: false,
  };
}

function strictNode(node: unknown, path: string, root: Schema): Schema {
  if (!isRecord(node) || !Object.keys(node).length) refuse(path, "acepta cualquier valor (subesquema vacío)");
  for (const key of REFUSED) if (has(node, key)) refuse(path, `usa ${key}`);

  // Strict mode allows nothing next to a $ref, so what describes it moves to a wrapper.
  if (has(node, "$ref")) {
    if (typeof node.$ref !== "string" || resolveRef(root, node.$ref) === undefined) refuse(path, `tiene una referencia que no se puede resolver: ${String(node.$ref)}`);
    const notes = Object.fromEntries(["description", "title"].filter((k) => has(node, k)).map((k) => [k, node[k]]));
    return Object.keys(notes).length ? { anyOf: [{ $ref: node.$ref }], ...notes } : { $ref: node.$ref };
  }

  const out: Schema = Object.fromEntries(KEPT.filter((k) => has(node, k)).map((k) => [k, node[k]]));
  if (typeof node.format === "string" && FORMATS.has(node.format)) out.format = node.format;

  const literals = has(node, "const") ? [node.const] : Array.isArray(node.enum) ? node.enum : undefined;
  if (literals) {
    if (!literals.length || literals.some((v) => typeof v === "object" && v !== null)) refuse(path, "tiene valores permitidos que no son texto, número, booleano o null");
    out.type ??= literalType(literals);
  }

  const alternatives = alternativesOf(node);
  if (alternatives || has(node, "anyOf") || has(node, "oneOf")) {
    if (has(node, "anyOf") && has(node, "oneOf")) refuse(path, "usa anyOf y oneOf a la vez");
    if (!alternatives?.length) refuse(path, "tiene una unión sin alternativas");
    if (["type", "const", "enum", "properties", "items"].some((k) => has(node, k))) refuse(path, "combina una unión con otras restricciones");
    out.anyOf = alternatives.map((a, i) => strictNode(a, `${at(path, "anyOf")}[${i}]`, root));
  } else {
    if (!has(out, "type") && has(node, "properties")) out.type = "object";
    if (!has(out, "type") && has(node, "items")) out.type = "array";
    const types = typesOf(out);
    if (!types?.length) refuse(path, "acepta cualquier valor (subesquema vacío)");
    if (types.includes("object")) Object.assign(out, strictObject(node, path, root));
    if (types.includes("array")) {
      if (!isRecord(node.items)) refuse(path, "es un array sin items");
      out.items = strictNode(node.items, `${path}[]`, root);
    }
  }

  for (const key of ["$defs", "definitions"]) {
    const defs = node[key];
    if (isRecord(defs)) out[key] = Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, strictNode(def, at(at(path, key), name), root)]));
  }
  return out;
}

/** The schema in strict form, as a new object. Throws, naming the path, when strict mode cannot express it. */
export function toStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type !== "object") refuse("", "tiene que ser un objeto");
  return strictNode(schema, "", schema);
}

function clean(node: unknown, value: unknown, root: Schema, seen: ReadonlySet<string> = new Set()): unknown {
  if (!isRecord(node)) return value;
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return value;
    return clean(resolveRef(root, node.$ref), value, root, new Set(seen).add(node.$ref));
  }
  const alternatives = alternativesOf(node);
  if (alternatives) {
    const branch = alternatives.find((a) => fits(a, value, root));
    return branch === undefined ? value : clean(branch, value, root, seen);
  }
  if (Array.isArray(value)) return value.map((v) => clean(node.items, v, root));
  if (!isRecord(value) || !isRecord(node.properties)) return value;
  const properties = node.properties;
  const required = Array.isArray(node.required) ? node.required : [];
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => !(v === null && has(properties, k) && !required.includes(k)))
      .map(([k, v]) => [k, has(properties, k) ? clean(properties[k], v, root) : v]),
  );
}

/** The answer without the nulls of properties that are optional in the original schema, as a new value. */
export function withoutOptionalNulls(schema: Record<string, unknown>, value: unknown): unknown {
  return clean(schema, value, schema);
}
