const IDENTIFIER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

/** Parses owner-only application state without trusting arbitrary URL values. */
export function parseRoute(input, base = "http://localhost/") {
  let url;
  try {
    url = new URL(input, base);
  } catch {
    return { name: "invalid", reason: "invalid_url" };
  }

  const taskId = url.searchParams.get("task");
  const matchCaseId = url.searchParams.get("match");
  const view = url.searchParams.get("view");
  if (matchCaseId && !taskId) return { name: "invalid", reason: "match_without_task" };
  if (taskId && !validIdentifier(taskId)) return { name: "invalid", reason: "invalid_task_id" };
  if (matchCaseId && !validIdentifier(matchCaseId)) return { name: "invalid", reason: "invalid_match_id" };
  if (taskId && matchCaseId) return { name: "match", taskId, matchCaseId };
  if (taskId) return { name: "task", taskId };
  if (view === "tasks") return { name: "task-center" };
  if (view) return { name: "invalid", reason: "unknown_view" };
  return { name: "home" };
}

export function buildRoute(route, input = "http://localhost/") {
  const current = new URL(input, "http://localhost/");
  const url = new URL(current.pathname || "/", current.origin);
  if (route?.name === "task-center") {
    url.searchParams.set("view", "tasks");
  } else if (route?.name === "task") {
    if (!validIdentifier(route.taskId)) throw new TypeError("无效的任务 ID");
    url.searchParams.set("task", route.taskId);
  } else if (route?.name === "match") {
    if (!validIdentifier(route.taskId) || !validIdentifier(route.matchCaseId)) {
      throw new TypeError("无效的任务或匹配案例 ID");
    }
    url.searchParams.set("task", route.taskId);
    url.searchParams.set("match", route.matchCaseId);
  } else if (route?.name !== "home") {
    throw new TypeError("未知路由");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildTaskRoute(taskId, input) {
  return buildRoute({ name: "task", taskId }, input);
}

export function buildMatchRoute(taskId, matchCaseId, input) {
  return buildRoute({ name: "match", taskId, matchCaseId }, input);
}

function navigate(method, route, navigation = globalThis) {
  const href = buildRoute(route, navigation.location?.href || "http://localhost/");
  navigation.history?.[method]?.({ route: route.name }, "", href);
  return href;
}

export function pushRoute(route, navigation) {
  return navigate("pushState", route, navigation);
}

export function replaceRoute(route, navigation) {
  return navigate("replaceState", route, navigation);
}
