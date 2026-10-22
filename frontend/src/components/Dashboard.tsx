import { Clock, Plus, Search, Upload } from "lucide-react";
import { useArcStore } from "../lib/store";

export function Dashboard() {
  const overview = useArcStore((s) => s.overview);
  const documents = overview?.documents || [];
  const recentProjects = documents.slice(0, 5);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-base-800">Dashboard</h1>
          <p className="text-base-600">Welcome to your design workspace</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600">
          <Plus size={16} />
          New Project
        </button>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-base-200 bg-base-100 p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600">
              <Plus size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-base-800">New Project</h2>
              <p className="text-sm text-base-600">Create a new design document</p>
            </div>
          </div>
          <button className="w-full rounded-md border border-base-300 bg-base-50 px-4 py-2 text-sm font-medium text-base-700 transition-colors hover:bg-base-100">
            Create Document
          </button>
        </div>

        <div className="rounded-lg border border-base-200 bg-base-100 p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-base-200 text-base-600">
              <Upload size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-base-800">Import File</h2>
              <p className="text-sm text-base-600">Import from your computer</p>
            </div>
          </div>
          <button className="w-full rounded-md border border-base-300 bg-base-50 px-4 py-2 text-sm font-medium text-base-700 transition-colors hover:bg-base-100">
            Import File
          </button>
        </div>

        <div className="rounded-lg border border-base-200 bg-base-100 p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-base-200 text-base-600">
              <Search size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-base-800">Search Templates</h2>
              <p className="text-sm text-base-600">Browse ready-to-use templates</p>
            </div>
          </div>
          <button className="w-full rounded-md border border-base-300 bg-base-50 px-4 py-2 text-sm font-medium text-base-700 transition-colors hover:bg-base-100">
            Browse Templates
          </button>
        </div>
      </div>

      {recentProjects.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-base-800">Recent Projects</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((doc) => (
              <div
                key={doc.id}
                className="group cursor-pointer rounded-lg border border-base-200 bg-base-100 p-4 transition-all hover:border-base-300 hover:shadow-md"
                onClick={() => {
                  useArcStore.getState().setDashboardTransition(true);
                  setTimeout(() => {
                    useArcStore.getState().setView("editor");
                    useArcStore.getState().setOverview({
                      ...overview,
                      active: doc.id,
                    });
                  }, 300);
                }}
              >
                <div className="mb-3 aspect-video rounded-md bg-gradient-to-br from-base-100 to-base-200" />
                <h3 className="font-medium text-base-800 group-hover:text-accent-600">
                  {doc.name}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-base-600">
                  <Clock size={12} />
                  {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : "Recently"}
                  {doc.dirty && (
                    <span className="ml-auto rounded bg-warning-100 px-2 py-0.5 text-warning-800">
                      Unsaved
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-6">
        <div className="rounded-lg border border-base-200 bg-base-50 p-4">
          <h3 className="mb-2 font-medium text-base-800">Quick Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-base-800">0</div>
              <div className="text-xs text-base-600">Documents</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-base-800">0</div>
              <div className="text-xs text-base-600">Projects</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-base-800">0</div>
              <div className="text-xs text-base-600">Workspaces</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
