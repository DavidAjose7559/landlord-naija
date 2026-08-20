export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 px-6 text-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
          LANDLORD — Naija Edition
        </h1>
        <p className="text-lg text-zinc-400">Buy Lagos. Own Naija.</p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          className="rounded-full bg-emerald-500 px-8 py-3 text-base font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
        >
          Create Game
        </button>
        <button
          type="button"
          className="rounded-full border border-zinc-700 px-8 py-3 text-base font-semibold text-zinc-50 transition-colors hover:bg-zinc-800"
        >
          Join Game
        </button>
      </div>
    </div>
  );
}
