"use client";

import { useState, useMemo } from "react";
import { Receipt, Plus, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WidgetSlot } from "../widget-slot";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableValue } from "@/components/ui/editable-value";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirror convex/schema.ts `expenses` table
// ---------------------------------------------------------------------------
interface Expense {
  _id: Id<"expenses">;
  name: string;
  amountGBP: number;
  category?: string;
  recurring?: boolean;
  dueDay?: number;
  createdAt: number;
  ownerId?: string;
}

// ---------------------------------------------------------------------------
// GBP formatter
// ---------------------------------------------------------------------------
const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// ---------------------------------------------------------------------------
// Quick-add row — name + amount + add (mirrors v1 hub-exp-input-row)
// ---------------------------------------------------------------------------
function QuickAdd({ onAdd }: { onAdd: (name: string, amount: number) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const submit = () => {
    const n = name.trim();
    const a = parseFloat(amount);
    if (!n || !Number.isFinite(a) || a <= 0) return;
    onAdd(n, a);
    setName("");
    setAmount("");
  };

  return (
    <div className="rounded-lg border border-rule-soft/40 bg-ink-2/40 px-2 py-1.5 flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Subscription name"
        className="flex-1 min-w-0 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <span className="font-mono text-[11px] text-paper-faint">£</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="0.00"
          step="0.01"
          inputMode="decimal"
          className="w-16 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint text-right"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        aria-label="Add expense"
        className="shrink-0 rounded bg-rose-soft/15 border border-rose-soft/30 px-2 py-0.5 text-rose-soft hover:bg-rose-soft/25 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------
export function ExpensesWidget() {
  const expenses = useQuery(api.expenses.list) as Expense[] | undefined;
  const addExpense = useMutation(api.expenses.add);
  const updateExpense = useMutation(api.expenses.update);
  const removeExpense = useMutation(api.expenses.remove);

  // Total monthly outflow (v1 summed all expense rows as the monthly figure).
  const total = useMemo(
    () => (expenses ?? []).reduce((s, e) => s + (Number.isFinite(e.amountGBP) ? e.amountGBP : 0), 0),
    [expenses],
  );

  // "accrued so far this month" — pro-rata of the monthly outflow (v1 hub-exp-modal-accrued).
  const accrued = useMemo(() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return total * (dayOfMonth / daysInMonth);
  }, [total]);

  return (
    <WidgetSlot size="medium" label="Expenses · Subscriptions">
      <div className="flex flex-col gap-2 p-2">
        {/* Headline — monthly outflow (negative, rose) */}
        <div className="rounded-lg border border-rose-soft/25 bg-rose-soft/[0.06] px-3 py-2.5">
          <div className="font-mono text-[24px] leading-none font-semibold text-rose-soft tabular-nums">
            <span className="opacity-70">−</span>
            {gbp(total).replace("£", "£")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            monthly outflow
            <span className="text-paper-dim/80">
              {" · "}
              {gbp(accrued)} accrued so far
            </span>
          </div>
        </div>

        {/* Quick-add */}
        <QuickAdd onAdd={(name, amountGBP) => addExpense({ name, amountGBP })} />

        {/* List */}
        {expenses === undefined ? (
          <div className="py-6 flex items-center justify-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint animate-pulse">
              loading…
            </span>
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title="No expenses yet"
            hint="Add a subscription above"
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {expenses.map((exp) => (
              <li
                key={exp._id}
                className="group flex items-center gap-2 rounded-lg border border-rule-soft/40 bg-ink-2/60 px-2 py-1.5"
              >
                <div className="flex-1 min-w-0 text-sm text-paper truncate">
                  <EditableValue
                    value={exp.name}
                    onCommit={(name) => name.trim() && updateExpense({ id: exp._id, name: name.trim() })}
                    placeholder="Name…"
                    className="w-full text-sm"
                  />
                </div>
                <div className="shrink-0 font-mono text-[13px] text-rose-soft tabular-nums">
                  <EditableValue
                    value={String(exp.amountGBP)}
                    type="number"
                    onCommit={(v) => {
                      const a = parseFloat(v);
                      if (Number.isFinite(a) && a > 0) updateExpense({ id: exp._id, amountGBP: a });
                    }}
                    placeholder="0"
                    className={cn("text-right", "before:content-['£'] before:opacity-60")}
                    inputClassName="w-20 text-right"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeExpense({ id: exp._id })}
                  aria-label="Delete expense"
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-paper-faint hover:text-rose-soft transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WidgetSlot>
  );
}
