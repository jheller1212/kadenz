import Link from "next/link";

const RPE_SCALE = [
  { level: 10, label: "Max effort", color: "#FF0000", desc: "All-out sprint. Cannot maintain." },
  { level: 9, label: "Very hard", color: "#FF3300", desc: "Race pace for short distances. Few words only." },
  { level: 8, label: "Hard", color: "#FF6600", desc: "Tempo/threshold effort. Short sentences." },
  { level: 7, label: "Somewhat hard", color: "#FF9900", desc: "Comfortably hard. Can talk in phrases." },
  { level: 6, label: "Moderate+", color: "#FFCC00", desc: "Steady effort. Starting to breathe harder." },
  { level: 5, label: "Moderate", color: "#CCDD00", desc: "Marathon pace feel. Controlled breathing." },
  { level: 4, label: "Fairly light", color: "#88CC00", desc: "Easy-moderate. Full conversation possible." },
  { level: 3, label: "Light", color: "#44BB00", desc: "Easy running. Can chat freely." },
  { level: 2, label: "Very light", color: "#22AA44", desc: "Warm-up / cool-down pace. Effortless." },
  { level: 1, label: "Minimal", color: "#2299AA", desc: "Walking pace. Barely above rest." },
];

export default function RPEPage() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="mx-auto flex w-full max-w-md flex-col px-4 pb-16 pt-10">
        {/* Header */}
        <header className="flex items-center gap-3 mb-6">
          <Link
            href="/settings"
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center text-text-2"
            aria-label="Back to settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-extrabold text-text-1">What is RPE?</h1>
        </header>

        {/* Intro */}
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 mb-5">
          <h2 className="text-lg font-bold text-text-1">Rate of Perceived Exertion</h2>
          <p className="text-sm text-text-2 mt-2 leading-relaxed">
            RPE is a way to measure workout intensity based on how hard the effort <em>feels</em> rather than
            hitting specific pace numbers. It&apos;s especially useful when conditions vary — heat, hills, fatigue,
            or altitude can all affect your pace without changing the actual training stimulus.
          </p>
          <p className="text-sm text-text-2 mt-2 leading-relaxed">
            Instead of targeting 5:00/km, you&apos;d target an RPE of 6-7 (moderate to somewhat hard).
            This lets your body self-regulate and prevents overtraining on bad days while still pushing
            appropriately on good days.
          </p>
        </section>

        {/* Modified Borg Scale */}
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 mb-5">
          <h2 className="text-lg font-bold text-text-1 mb-4">The Modified Borg Scale</h2>
          <div className="flex flex-col gap-1">
            {RPE_SCALE.map(({ level, label, color, desc }) => (
              <div key={level} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold text-bg shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {level}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-1">{label}</p>
                  <p className="text-xs text-text-3 truncate">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* When to use RPE */}
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
          <h2 className="text-lg font-bold text-text-1">When to use RPE</h2>
          <div className="mt-3 flex flex-col gap-3">
            {[
              {
                title: "Hot or humid conditions",
                desc: "Your pace will naturally slow. RPE keeps the physiological effort consistent.",
              },
              {
                title: "Hilly terrain",
                desc: "Pace varies on hills but RPE stays constant — effort matters more than splits.",
              },
              {
                title: "Coming back from injury or illness",
                desc: "Let your body guide the effort instead of chasing old pace targets.",
              },
              {
                title: "New to running",
                desc: "If you don't have established race times, RPE is simpler than pace-based training.",
              },
              {
                title: "Easy runs",
                desc: "Many runners go too fast on easy days. RPE 3-4 keeps you honest — truly easy should feel easy.",
              },
            ].map(({ title, desc }) => (
              <div key={title}>
                <p className="text-sm font-semibold text-text-1">{title}</p>
                <p className="text-xs text-text-3 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* RPE mapping for running */}
          <div className="mt-5 rounded-[var(--radius-input)] bg-elevated p-4">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-2">Quick reference</p>
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-text-2">Easy / Recovery</span>
                <span className="font-semibold text-[#44BB00]">RPE 2–3</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-2">Long Run</span>
                <span className="font-semibold text-[#88CC00]">RPE 3–4</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-2">Marathon Pace</span>
                <span className="font-semibold text-[#CCDD00]">RPE 5–6</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-2">Tempo / Threshold</span>
                <span className="font-semibold text-[#FF9900]">RPE 7–8</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-2">Intervals</span>
                <span className="font-semibold text-[#FF3300]">RPE 8–9</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-2">Sprint / Race finish</span>
                <span className="font-semibold text-[#FF0000]">RPE 10</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
