/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as binance from "../binance.js";
import type * as browserbaseActions from "../browserbaseActions.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as expenses from "../expenses.js";
import type * as huntActions from "../huntActions.js";
import type * as hunts from "../hunts.js";
import type * as ideas from "../ideas.js";
import type * as jarvisContext from "../jarvisContext.js";
import type * as notes from "../notes.js";
import type * as projects from "../projects.js";
import type * as secrets from "../secrets.js";
import type * as settings from "../settings.js";
import type * as todos from "../todos.js";
import type * as travelActions from "../travelActions.js";
import type * as travelCache from "../travelCache.js";
import type * as tripExtras from "../tripExtras.js";
import type * as trips from "../trips.js";
import type * as vaultAuth from "../vaultAuth.js";
import type * as wealth from "../wealth.js";
import type * as wealthActions from "../wealthActions.js";
import type * as widgets from "../widgets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  binance: typeof binance;
  browserbaseActions: typeof browserbaseActions;
  crons: typeof crons;
  events: typeof events;
  expenses: typeof expenses;
  huntActions: typeof huntActions;
  hunts: typeof hunts;
  ideas: typeof ideas;
  jarvisContext: typeof jarvisContext;
  notes: typeof notes;
  projects: typeof projects;
  secrets: typeof secrets;
  settings: typeof settings;
  todos: typeof todos;
  travelActions: typeof travelActions;
  travelCache: typeof travelCache;
  tripExtras: typeof tripExtras;
  trips: typeof trips;
  vaultAuth: typeof vaultAuth;
  wealth: typeof wealth;
  wealthActions: typeof wealthActions;
  widgets: typeof widgets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
