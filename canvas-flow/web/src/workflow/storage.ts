import type { CanvasProject, WorkflowSnapshot } from "./types";

const DB_NAME = "ai-image-canvas";
const DB_VERSION = 1;
const STORE_NAME = "projects";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "project.id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkflow(snapshot: WorkflowSnapshot): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function loadWorkflow(projectId: string): Promise<WorkflowSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  const result = await new Promise<WorkflowSnapshot | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(projectId);
    request.onsuccess = () => resolve((request.result as WorkflowSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function listWorkflowProjects(): Promise<CanvasProject[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const snapshots = await new Promise<WorkflowSnapshot[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as WorkflowSnapshot[] | undefined) ?? []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return snapshots
    .map((snapshot) => snapshot.project)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
