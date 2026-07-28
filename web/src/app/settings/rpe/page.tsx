"use client";

import { ChevronLeft } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { useSwipeBack } from "@/lib/useSwipeBack";

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
  useSwipeBack();
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="What is RPE?"
        large={false}
        left={
          <TransitionLink
            href="/settings"
            className="press flex items-center gap-0.5 text-[17px] font-medium text-accent-fg"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            Me
          </TransitionLink>
        }
      />

      <div className="flex flex-col gap-3 px-4 pb-tabbar">
        {/* Intro */}
        <section className="k-card p-4">
          <h2 className="text-[17px] font-bold text-text-1">Rate of Perceived Exertion</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-text-2">
            RPE is a way to measure workout intensity based on how hard the effort <em>feels</em> rather than
            hitting specific pace numbers. It&apos;s especially useful when conditions vary: heat, hills, fatigue,
            or altitude can all affect your pace without changing the actual training stimulus.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-text-2">
            Instead of targeting 5:00/km, you&apos;d target an RPE of 6-7 (moderate to somewhat hard).
            This lets your body self-regulate and prevents overtraining on bad days while still pushing
            appropriately on good days.
          </p>
        </section>

        {/* Modified Borg Scale */}
        <section className="k-card p-4">
          <h2 className="mb-3 text-[17px] font-bold text-text-1">The Modified Borg Scale</h2>
          <div className="flex flex-col gap-1">
            {RPE_SCALE.map(({ level, label, color, desc }) => (
              <div key={level} className="flex items-center gap-3 py-1">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold text-bg"
                  style={{ backgroundColor: color }}
                >
                  {level}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-text-1">{label}</p>
                  <p className="truncate text-[13px] text-text-3">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* When to use RPE */}
        <section className="k-card p-4">
          <h2 className="text-[17px] font-bold text-text-1">When to use RPE</h2>
          <div className="mt-3 flex flex-col gap-3">
            {[
              {
                title: "Hot or humid conditions",
                desc: "Your pace will naturally slow. RPE keeps the physiological effort consistent.",
              },
              {
                title: "Hilly terrain",
                desc: "Pace varies on hills but RPE stays constant: effort matters more than splits.",
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
                desc: "Many runners go too fast on easy days. RPE 3-4 keeps you honest: truly easy should feel easy.",
              },
            ].map(({ title, desc }) => (
              <div key={title}>
                <p className="text-[15px] font-medium text-text-1">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-3">{desc}</p>
              </div>
            ))}
          </div>

          {/* RPE mapping for running */}
          <div className="mt-5 rounded-[var(--radius-input)] bg-elevated p-4">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">Quick reference</p>
            <div className="flex flex-col gap-1.5 text-[14px]">
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
      </div>
    </main>
  );
}
