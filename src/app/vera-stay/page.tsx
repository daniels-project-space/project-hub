"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, MapPin, MoveUpRight, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./vera-stay.module.css";

const scenes = [
  {
    eyebrow: "01 · Arrival",
    title: "Meet the horizon before you meet the house.",
    detail: "An uninterrupted approach, a protected pool terrace, and the coast held in a single frame.",
    image: "/images/vera/coast-house.png",
    marker: "Pool terrace",
  },
  {
    eyebrow: "02 · Living",
    title: "Every important room, in its real light.",
    detail: "Glass, limestone and sea air. See how the home holds the afternoon before you ever arrive.",
    image: "/images/vera/living-room.png",
    marker: "Living room",
  },
  {
    eyebrow: "03 · Rest",
    title: "Stay long enough for the view to become yours.",
    detail: "A quiet suite opening straight to the water, with the last warm light moving across the stone.",
    image: "/images/vera/primary-suite.png",
    marker: "Primary suite",
  },
] as const;

const collection = [
  { title: "Aster House", location: "Milos, Greece", price: "€684 / night", image: scenes[0].image },
  { title: "Ila House", location: "Puglia, Italy", price: "€531 / night", image: scenes[1].image },
  { title: "Tide House", location: "Paros, Greece", price: "€412 / night", image: scenes[2].image },
] as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export default function VeraStayPage() {
  const heroRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const tourVideoRef = useRef<HTMLVideoElement>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourScene, setTourScene] = useState(0);
  const [tourVideoReady, setTourVideoReady] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = heroRef.current;
      const story = storyRef.current;
      if (hero) {
        hero.style.setProperty("--hero-progress", String(clamp(window.scrollY / (window.innerHeight * 0.92))));
      }
      if (story) {
        const rect = story.getBoundingClientRect();
        const distance = story.offsetHeight - window.innerHeight;
        const progress = clamp((-rect.top) / Math.max(distance, 1));
        story.style.setProperty("--story-progress", String(progress));
        story.style.setProperty("--scene-one", String(clamp((0.4 - progress) / 0.1)));
        story.style.setProperty("--scene-two", String(clamp(Math.min((progress - 0.3) / 0.1, (0.7 - progress) / 0.1))));
        story.style.setProperty("--scene-three", String(clamp((progress - 0.6) / 0.1)));
        const video = tourVideoRef.current;
        if (tourVideoReady && video?.duration) {
          const nextTime = Math.min(Math.max(progress * video.duration, 0), Math.max(video.duration - 0.04, 0));
          if (Math.abs(video.currentTime - nextTime) > 0.045) video.currentTime = nextTime;
        }
      }
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [tourVideoReady]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add(styles.isVisible)),
      { threshold: 0.16 },
    );
    document.querySelectorAll(`.${styles.reveal}`).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!tourOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setTourOpen(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tourOpen]);

  const setHeroPointer = (event: React.MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", String((event.clientX - bounds.left) / bounds.width - 0.5));
    event.currentTarget.style.setProperty("--pointer-y", String((event.clientY - bounds.top) / bounds.height - 0.5));
  };

  const openTour = (index = 0) => {
    setTourScene(index);
    setTourOpen(true);
  };

  return (
    <main className={styles.page}>
      <section id="top" ref={heroRef} onMouseMove={setHeroPointer} className={styles.hero}>
        <div className={styles.heroMedia}>
          <Image src={scenes[0].image} alt="Aster House on the coast at golden hour" fill priority loading="eager" sizes="100vw" className={styles.heroImage} />
        </div>
        <div className={styles.heroShade} />
        <div className={styles.heroGrain} />

        <header className={styles.nav}>
          <Link href="/" className={styles.wordmark} aria-label="Return to Project Hub">
            <span className={styles.mark}>V</span><span>VERA</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Vera navigation">
            <a href="#collection">Explore stays</a>
            <a href="#standard">The standard</a>
            <a href="#hosts">For hosts</a>
          </nav>
          <a href="#hosts" className={styles.listHome}>List your home <ArrowUpRight aria-hidden="true" /></a>
        </header>

        <div className={styles.heroRule} />
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}><i /> Verified spaces. Better stays.</p>
          <h1>Book the home<br />you can actually<br /><em>explore.</em></h1>
          <p className={styles.heroIntro}>Vera is a visual-first collection of remarkable homes. Walk every room, know the details, and book with confidence.</p>
          <div className={styles.heroActions}>
            <button className={styles.solidAction} onClick={() => openTour()}><Play aria-hidden="true" /> Walk this home <ArrowUpRight aria-hidden="true" /></button>
            <a className={styles.textAction} href="#collection">Explore the collection <ArrowUpRight aria-hidden="true" /></a>
          </div>
        </div>
        <div className={styles.heroMeta}>
          <span>01 / 12</span>
          <div><small>Featured stay</small><strong>Aster House, Milos</strong></div>
        </div>
        <button className={styles.tourLauncher} onClick={() => openTour()}>
          <span><MoveUpRight aria-hidden="true" /></span>
          <b>Open verified tour<small>4 rooms, 2,400 sq ft</small></b>
        </button>
        <a href="#standard" className={styles.scrollCue} aria-label="Scroll to explore"><span>Scroll to enter</span><ArrowDown aria-hidden="true" /></a>
      </section>

      <section id="standard" className={styles.standard}>
        <div className={`${styles.standardLead} ${styles.reveal}`}>
          <span>Vera standard</span>
          <h2>The picture should be the proof.</h2>
        </div>
        <div className={styles.standardList}>
          {[
            ["01", "Walk before you book", "Spatial scenes make the light, layout and scale clear."],
            ["02", "See the essential details", "The details that decide a stay live in the tour, not fine print."],
            ["03", "Choose with calm", "A smaller collection, presented with enough care to trust it."],
          ].map(([number, title, copy]) => <article className={styles.reveal} key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section ref={storyRef} className={`${styles.story} ${tourVideoReady ? styles.hasTourVideo : ""}`} aria-label="Aster House visual walkthrough">
        <div className={styles.storySticky}>
          <video ref={tourVideoRef} className={styles.storyVideo} muted playsInline preload="auto" poster={scenes[0].image} onLoadedMetadata={() => setTourVideoReady(true)} onError={() => setTourVideoReady(false)}>
            <source src="/videos/vera/aster-house-tour.mp4" type="video/mp4" />
          </video>
          {scenes.map((scene, index) => (
            <figure className={`${styles.storyScene} ${styles[`scene${index + 1}`]}`} key={scene.title}>
              <Image src={scene.image} alt="" fill sizes="100vw" className={styles.storyImage} />
              <div className={styles.storyShade} />
            </figure>
          ))}
          <div className={styles.storyTopline}><span>Aster House / visual walkthrough</span><span>01—03</span></div>
          <div className={styles.storyText}>
            {scenes.map((scene, index) => <div className={styles[`storyCopy${index + 1}`]} key={scene.title}><p>{scene.eyebrow}</p><h2>{scene.title}</h2><span>{scene.detail}</span></div>)}
          </div>
          <div className={styles.storyProgress}><i /><i /><i /></div>
          <button className={styles.storyOpen} onClick={() => openTour(1)}>Enter the tour <ArrowUpRight aria-hidden="true" /></button>
        </div>
      </section>

      <section id="collection" className={styles.collection}>
        <div className={`${styles.collectionHeading} ${styles.reveal}`}>
          <div><span>Current collection</span><h2>Stay somewhere<br /><em>worth arriving.</em></h2></div>
          <p>Every home begins with a visual walkthrough. The collection is designed to feel less like a feed and more like a considered invitation.</p>
        </div>
        <div className={styles.propertyGrid}>
          {collection.map((stay, index) => <button className={`${styles.propertyCard} ${styles.reveal}`} onClick={() => openTour(index)} key={stay.title}>
            <span className={styles.cardMedia}><Image src={stay.image} alt={`${stay.title} visual preview`} fill sizes="(max-width: 760px) 100vw, 33vw" /><i>Verified tour</i><em>0{index + 1}</em></span>
            <span className={styles.cardInfo}><span><b>{stay.title}</b><small><MapPin aria-hidden="true" />{stay.location}</small></span><strong>{stay.price}</strong></span>
          </button>)}
        </div>
      </section>

      <section id="hosts" className={styles.hosts}>
        <Image src={scenes[1].image} alt="Warm living room looking towards the sea" fill sizes="100vw" className={styles.hostImage} />
        <div className={styles.hostShade} />
        <div className={`${styles.hostCopy} ${styles.reveal}`}><span>For considered hosts</span><h2>Your home deserves more than a thumbnail.</h2><p>Vera&apos;s launch collection is sourced with owner permission, a verified visual walkthrough, and an editorial property story.</p><a href="#collection">See the Vera standard <ArrowUpRight aria-hidden="true" /></a></div>
      </section>

      <footer className={styles.footer}><Link href="/" className={styles.wordmark}><span className={styles.mark}>V</span><span>VERA</span></Link><span>Visual-first stay marketplace — concept experience</span><a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Back to top <ArrowUpRight aria-hidden="true" /></a></footer>

      {tourOpen && <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Verified visual tour">
        <button className={styles.modalBackdrop} onClick={() => setTourOpen(false)} aria-label="Close tour" />
        <section className={styles.modalPanel}>
          <header><div><span>Verified visual walkthrough</span><h2>Aster House</h2></div><button onClick={() => setTourOpen(false)} aria-label="Close tour"><X /></button></header>
          <div className={styles.modalImage}>{tourVideoReady ? <video className={styles.modalVideo} src="/videos/vera/aster-house-tour.mp4" poster={scenes[tourScene].image} controls autoPlay muted playsInline /> : <Image src={scenes[tourScene].image} alt={scenes[tourScene].marker} fill sizes="min(94vw, 1180px)" />}<div /><button className={styles.locationPin} onClick={() => setTourScene((tourScene + 1) % scenes.length)}><i />{scenes[tourScene].marker}</button><span>Visual scene {String(tourScene + 1).padStart(2, "0")} / 03</span></div>
          <div className={styles.modalFoot}><div className={styles.sceneTabs}>{scenes.map((scene, index) => <button className={index === tourScene ? styles.activeTab : ""} key={scene.title} onClick={() => setTourScene(index)}><b>0{index + 1}</b>{scene.eyebrow.split("· ")[1]}</button>)}</div><p>{scenes[tourScene].detail}</p><div className={styles.modalArrows}><button onClick={() => setTourScene((tourScene + scenes.length - 1) % scenes.length)} aria-label="Previous scene"><ChevronLeft /></button><button onClick={() => setTourScene((tourScene + 1) % scenes.length)} aria-label="Next scene"><ChevronRight /></button></div></div>
        </section>
      </div>}
    </main>
  );
}
