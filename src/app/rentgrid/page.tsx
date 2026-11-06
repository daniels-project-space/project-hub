import Image from "next/image";
import Link from "next/link";
import { getAppIcon } from "@/lib/app-icons";
import styles from "./rentgrid.module.css";

const stages = [
  {
    label: "Working foundation",
    state: "Local development",
    items: ["Inventory", "Internal bookings", "Workspace settings"],
  },
  {
    label: "Building next",
    state: "In progress",
    items: ["Files & photos", "Gear insights", "Private tools"],
  },
  {
    label: "iOS release",
    state: "Qualification ahead",
    items: ["Device testing", "TestFlight", "App Store"],
  },
];
export default function RentGridProject() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Project Hub
        </Link>
        <span className={styles.badge}>WIP · Local development</span>
      </header>
      <section className={styles.hero}>
        <div className={styles.intro}>
          <div className={styles.brand}>
            <span aria-hidden="true">{getAppIcon("rentgrid")}</span>RentGrid
          </div>
          <h1>
            Your gear. Your rental
            <br />
            business. <em>In one place.</em>
          </h1>
          <p>
            An iOS-first workspace for rental owners and teams, with a Mac
            companion.
          </p>
          <span className={styles.access}>
            Development previews stay local. Public release is pending.
          </span>
          <div className={styles.links}>
            <a
              href="https://github.com/daniels-project-space/rentgrid"
              target="_blank"
              rel="noreferrer"
            >
              GitHub source ↗
            </a>
          </div>
        </div>
        <figure className={styles.vision}>
          <Image
            src="/images/rentgrid/today-v2.png"
            alt="RentGrid Today design reference with revenue, gear, next-calendar and insight tiles; fictional Northlight Rentals sample data"
            width={852}
            height={1846}
            priority
            sizes="(max-width:700px) 80vw, 340px"
          />
          <figcaption>Product vision · fictional sample data</figcaption>
        </figure>
      </section>
      <section aria-label="Build stages" className={styles.stages}>
        {stages.map((stage) => (
          <article key={stage.label} className={styles.stage}>
            <span className={styles.stageState}>{stage.state}</span>
            <h2>{stage.label}</h2>
            <ul>
              {stage.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <footer className={styles.footer}>
        <p>
          The app is in local development. Native device testing and public
          App Store distribution are still ahead.
        </p>
        <p>
          Hygglo is a planned partner connection. Requesting access records
          interest and does not connect an account.
        </p>
      </footer>
    </main>
  );
}
