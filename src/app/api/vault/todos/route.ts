import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import {
  hasValidVaultSession,
  VAULT_SESSION_COOKIE,
  VaultControlConfigurationError,
} from "@/lib/vault-control";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

type TodoCreate = {
  text: string;
  priority?: number;
  dueDate?: number;
  tags?: string[];
  projectSlug?: string;
};

type TodoUpdate = {
  id: string;
  text?: string;
  done?: boolean;
  priority?: number;
  dueDate?: number;
  tags?: string[];
  projectSlug?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Vault sign-in required." }, { status: 401, headers: noStore });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function signedIn(request: NextRequest): string | undefined {
  const session = request.cookies.get(VAULT_SESSION_COOKIE)?.value;
  return hasValidVaultSession(session) ? session : undefined;
}

function todosClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new VaultControlConfigurationError();
  return new ConvexHttpClient(url);
}

function errorResponse(error: unknown) {
  if (error instanceof VaultControlConfigurationError) {
    return NextResponse.json({ error: "Todo control is not configured yet." }, { status: 503, headers: noStore });
  }
  return NextResponse.json({ error: "Todo operation could not be completed." }, { status: 400, headers: noStore });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isTodoCreate(value: unknown): value is TodoCreate {
  if (!isRecord(value) || typeof value.text !== "string") return false;
  return hasOnlyKeys(value, ["text", "priority", "dueDate", "tags", "projectSlug"])
    && isOptionalFiniteNumber(value.priority)
    && isOptionalFiniteNumber(value.dueDate)
    && isOptionalStringArray(value.tags)
    && isOptionalString(value.projectSlug);
}

function isTodoUpdate(value: unknown): value is TodoUpdate {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  const hasPatch = ["text", "done", "priority", "dueDate", "tags", "projectSlug"].some((key) => key in value);
  return hasOnlyKeys(value, ["id", "text", "done", "priority", "dueDate", "tags", "projectSlug"])
    && hasPatch
    && isOptionalString(value.text)
    && (value.done === undefined || typeof value.done === "boolean")
    && isOptionalFiniteNumber(value.priority)
    && isOptionalFiniteNumber(value.dueDate)
    && isOptionalStringArray(value.tags)
    && isOptionalString(value.projectSlug);
}

function isTodoId(value: unknown): value is { id: string } {
  return isRecord(value) && hasOnlyKeys(value, ["id"]) && typeof value.id === "string";
}

function isTodoReorder(value: unknown): value is { ids: string[] } {
  return isRecord(value)
    && hasOnlyKeys(value, ["ids"])
    && Array.isArray(value.ids)
    && value.ids.every((id) => typeof id === "string");
}

async function json(request: NextRequest): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  try {
    const todos = await todosClient().query(api.todos.list, { vaultSession });
    return NextResponse.json({ todos }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site todo writes are blocked." }, { status: 403, headers: noStore });
  }
  const body = await json(request);
  if (!isTodoCreate(body)) {
    return NextResponse.json({ error: "Invalid todo." }, { status: 400, headers: noStore });
  }
  try {
    const id = await todosClient().mutation(api.todos.add, {
      vaultSession,
      text: body.text,
      priority: body.priority,
      dueDate: body.dueDate,
      tags: body.tags,
      projectSlug: body.projectSlug,
    });
    return NextResponse.json({ id }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site todo writes are blocked." }, { status: 403, headers: noStore });
  }
  const body = await json(request);
  if (!isTodoUpdate(body)) {
    return NextResponse.json({ error: "Invalid todo update." }, { status: 400, headers: noStore });
  }
  try {
    const id = await todosClient().mutation(api.todos.update, {
      vaultSession,
      id: body.id as Id<"todos">,
      text: body.text,
      done: body.done,
      priority: body.priority,
      dueDate: body.dueDate,
      tags: body.tags,
      projectSlug: body.projectSlug,
    });
    return NextResponse.json({ id }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site todo writes are blocked." }, { status: 403, headers: noStore });
  }
  const body = await json(request);
  if (!isTodoId(body)) {
    return NextResponse.json({ error: "Invalid todo." }, { status: 400, headers: noStore });
  }
  try {
    await todosClient().mutation(api.todos.remove, {
      vaultSession,
      id: body.id as Id<"todos">,
    });
    return NextResponse.json({ removed: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const vaultSession = signedIn(request);
  if (!vaultSession) return unauthorized();
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site todo writes are blocked." }, { status: 403, headers: noStore });
  }
  const body = await json(request);
  if (!isTodoReorder(body)) {
    return NextResponse.json({ error: "Invalid todo order." }, { status: 400, headers: noStore });
  }
  try {
    await todosClient().mutation(api.todos.reorder, {
      vaultSession,
      ids: body.ids as Id<"todos">[],
    });
    return NextResponse.json({ reordered: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
