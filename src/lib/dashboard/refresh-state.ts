export type RefreshState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

export type RefreshAction =
  | { type: "start" }
  | { type: "success" }
  | { type: "fail"; message: string };

export const initialRefresh: RefreshState = { status: "idle" };

// Satu refresh sekali jalan: "start" saat loading mengembalikan state yang sama.
export function refreshReducer(state: RefreshState, action: RefreshAction): RefreshState {
  switch (action.type) {
    case "start":
      return state.status === "loading" ? state : { status: "loading" };
    case "success":
      return state.status === "loading" ? { status: "idle" } : state;
    case "fail":
      return state.status === "loading" ? { status: "error", message: action.message } : state;
  }
}

// ponytail: simulasi mock 800 ms; ganti dengan fetch GET /api/v1/routers saat backend REST siap.
export function mockRefresh(online: boolean = true, ms = 800): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => (online ? resolve() : reject(new Error("Tidak ada koneksi jaringan."))), ms);
  });
}
