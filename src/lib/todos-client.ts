"use client";

import {
  createElement,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Id } from "../../convex/_generated/dataModel";

export type HubTodo = {
  _id: Id<"todos">;
  text: string;
  done: boolean;
  priority: number;
  dueDate?: number;
  tags: string[];
  projectSlug?: string;
  position: number;
  createdAt: number;
  ownerId?: string;
};

export type TodoAccessState = "loading" | "ready" | "unauthorized" | "error";

type TodoCreate = {
  text: string;
  priority?: number;
  dueDate?: number;
  tags?: string[];
  projectSlug?: string;
};

type TodoUpdate = {
  id: Id<"todos">;
  text?: string;
  done?: boolean;
  priority?: number;
  dueDate?: number;
  tags?: string[];
  projectSlug?: string;
};

type TodoResponse = {
  todos?: HubTodo[];
  error?: string;
};

type TodosController = {
  todos: HubTodo[] | undefined;
  access: TodoAccessState;
  refresh: () => Promise<boolean>;
  add: (todo: TodoCreate) => Promise<boolean>;
  update: (todo: TodoUpdate) => Promise<boolean>;
  remove: (id: Id<"todos">) => Promise<boolean>;
  reorder: (ids: Id<"todos">[]) => Promise<boolean>;
};

const TodosContext = createContext<TodosController | null>(null);

async function responseBody(response: Response): Promise<TodoResponse> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as TodoResponse : {};
  } catch {
    return {};
  }
}

/**
 * Browser-only facade for private Hub todos. It deliberately talks only to the
 * same-origin owner route; importing Convex's public function references here
 * would make the capability check easy to accidentally bypass in a future UI.
 */
function useTodosController(): TodosController {
  const mounted = useRef(true);
  const [todos, setTodos] = useState<HubTodo[] | undefined>(undefined);
  const [access, setAccess] = useState<TodoAccessState>("loading");

  const setState = useCallback((next: TodoAccessState, nextTodos?: HubTodo[]) => {
    if (!mounted.current) return;
    setAccess(next);
    if (nextTodos !== undefined) setTodos(nextTodos);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/vault/todos", { cache: "no-store" });
      const body = await responseBody(response);
      if (response.status === 401) {
        setState("unauthorized", []);
        return false;
      }
      if (!response.ok || !Array.isArray(body.todos)) {
        setState("error", []);
        return false;
      }
      setState("ready", body.todos);
      return true;
    } catch {
      setState("error", []);
      return false;
    }
  }, [setState]);

  useEffect(() => {
    mounted.current = true;
    // Defer initial hydration so the effect subscribes to async work rather
    // than synchronously cascading a state update during commit.
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(), 30_000);
    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [refresh]);

  const mutate = useCallback(async (method: "POST" | "PATCH" | "PUT" | "DELETE", payload: object): Promise<boolean> => {
    try {
      const response = await fetch("/api/vault/todos", {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setState("unauthorized", []);
        return false;
      }
      if (!response.ok) {
        setState("error");
        return false;
      }
      return await refresh();
    } catch {
      setState("error");
      return false;
    }
  }, [refresh, setState]);

  return {
    todos,
    access,
    refresh,
    add: (todo: TodoCreate) => mutate("POST", todo),
    update: (todo: TodoUpdate) => mutate("PATCH", todo),
    remove: (id: Id<"todos">) => mutate("DELETE", { id }),
    reorder: (ids: Id<"todos">[]) => mutate("PUT", { ids }),
  };
}

export function TodosProvider({ children }: { children: ReactNode }) {
  const value = useTodosController();
  return createElement(TodosContext.Provider, { value }, children);
}

export function useTodos(): TodosController {
  const controller = useContext(TodosContext);
  if (!controller) throw new Error("useTodos must be used inside TodosProvider");
  return controller;
}
