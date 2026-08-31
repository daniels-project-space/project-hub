"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
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

const orbitalPoster = "/images/vera/orbital-distant.png";
const scrollTour = "/videos/vera/aster-house-forward-scroll-master.mp4";
const openingIdleTour = "/videos/vera/aster-house-globe-idle-loop.mp4";
const endingIdleTour = "/videos/vera/aster-house-suite-idle-loop.mp4";
const modalSceneProgress = [0.3, 0.54, 0.82] as const;

const tourChapters = [
  { id: "orbit", number: "01", label: "Orbit", marker: "Above the Aegean", direction: "Hold the horizon", progress: 0.02 },
  { id: "descent", number: "02", label: "Descent", marker: "Aegean approach", direction: "Begin the slow descent", progress: 0.1 },
  { id: "arrival", number: "03", label: "Arrival", marker: "Aster House", direction: "Follow the stone path", progress: 0.25 },
  { id: "inside", number: "04", label: "Inside", marker: "Glass living room", direction: "Cross the threshold", progress: 0.52 },
  { id: "suite", number: "05", label: "Suite", marker: "Primary suite", direction: "Arrive by the water", progress: 0.79 },
  { id: "stillness", number: "06", label: "Stillness", marker: "Water at dusk", direction: "Stay with the view", progress: 0.98 },
] as const;

const tourChapterDetails = [
  { heading: "Begin beyond\nthe map.", copy: "Take a moment above the Aegean before moving. This opening is deliberately held, not rushed.", facts: ["Long-form scroll film", "Aegean Sea / Greece"] },
  { heading: "Let the horizon\ncome closer.", copy: "The descent is paced as a slow approach, leaving enough space to read the route and keep your place in the story.", facts: ["Slow camera cadence", "No forced scroll timing"] },
  { heading: "Arrive at\nAster House.", copy: "This is the verified Aster exterior: the same pool, stone path and glass facade that anchor the interior scenes ahead.", facts: ["Verified exterior", "Infinity pool"] },
  { heading: "Read the room\nin its real light.", copy: "The move now continues through the same home, at one eye level, so material, light and the coastline remain legible.", facts: ["Full-height glass", "Limestone interior"] },
  { heading: "End where\nthe view begins.", copy: "The final room slows down. Let the terrace, water and last light stay in frame instead of cutting away.", facts: ["Primary suite", "Open sea horizon"] },
  { heading: "Stay with\nthe water.", copy: "At the end, the film becomes an idle view: a quiet looping moment of the suite and moving water at dusk.", facts: ["Seamless idle loop", "Water at blue hour"] },
] as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export default function VeraStayPage() {
  const storyRef = useRef<HTMLElement>(null);
  const tourVideoRef = useRef<HTMLVideoElement>(null);
  const openingIdleRef = useRef<HTMLVideoElement>(null);
  const endingIdleRef = useRef<HTMLVideoElement>(null);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const activeStorySceneRef = useRef(0);
  const storyProgressRef = useRef(0);
  const storyHasStartedRef = useRef(false);
  const hasTakenScrollControlRef = useRef(false);
  const scrollStartProgressRef = useRef<number | null>(null);
  const targetVideoTimeRef = useRef<number | null>(null);
  const motionFrameRef = useRef(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourScene, setTourScene] = useState(0);
  const [tourVideoReady, setTourVideoReady] = useState(false);
  const [endingIdleActive, setEndingIdleActive] = useState(false);
  const [activeStoryScene, setActiveStoryScene] = useState(0);
  const [storyHasStarted, setStoryHasStarted] = useState(false);
  const [scrollHasTakenControl, setScrollHasTakenControl] = useState(false);

  useEffect(() => {
    const video = tourVideoRef.current;
    if (!video) return;
    let stopChecking = () => {};
    let hasInitializedFrame = false;
    const markReady = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (!hasInitializedFrame) {
          hasInitializedFrame = true;
          video.pause();
          video.currentTime = 0;
        }
        setTourVideoReady(true);
        stopChecking();
      }
    };
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("canplay", markReady);
    video.addEventListener("canplaythrough", markReady);
    video.load();
    const readyCheck = window.setInterval(markReady, 125);
    stopChecking = () => window.clearInterval(readyCheck);
    markReady();
    return () => {
      stopChecking();
      video.removeEventListener("loadeddata", markReady);
      video.removeEventListener("canplay", markReady);
      video.removeEventListener("canplaythrough", markReady);
    };
  }, []);

  useEffect(() => {
    const opening = openingIdleRef.current;
    if (!opening) return;
    if (scrollHasTakenControl) {
      opening.pause();
      return;
    }
    void opening.play().catch(() => undefined);
  }, [scrollHasTakenControl]);

  useEffect(() => {
    let updateFrame = 0;
    const animateTowardScrollTarget = () => {
      motionFrameRef.current = 0;
      const video = tourVideoRef.current;
      const targetTime = targetVideoTimeRef.current;
      if (!tourVideoReady || !video?.duration || targetTime === null) return;
      const difference = targetTime - video.currentTime;
      if (difference > 0.035) {
        video.playbackRate = Math.min(2.4, Math.max(0.4, difference * 1.8));
        void video.play().catch(() => undefined);
        motionFrameRef.current = window.requestAnimationFrame(animateTowardScrollTarget);
        return;
      }
      if (difference < -0.035) {
        video.pause();
        video.currentTime = Math.max(0, video.currentTime + Math.max(difference * 0.16, -0.18));
        motionFrameRef.current = window.requestAnimationFrame(animateTowardScrollTarget);
        return;
      }
      video.pause();
      video.playbackRate = 1;
      if (targetTime >= video.duration - 0.09) setEndingIdleActive(true);
    };
    const requestMotion = () => {
      if (!motionFrameRef.current) motionFrameRef.current = window.requestAnimationFrame(animateTowardScrollTarget);
    };
    const update = () => {
      updateFrame = 0;
      const story = storyRef.current;
      if (story) {
        const rect = story.getBoundingClientRect();
        const distance = story.offsetHeight - window.innerHeight;
        const progress = clamp((-rect.top) / Math.max(distance, 1));
        const video = tourVideoRef.current;
        const masterDuration = tourVideoReady && video?.duration ? video.duration : 40.017;
        const scrollStart = scrollStartProgressRef.current;
        let targetTime = 0;
        if (scrollStart !== null) {
          const normalizedScroll = clamp((progress - scrollStart) / Math.max(1 - scrollStart, 0.01));
          targetTime = 0.35 + (masterDuration - 0.39) * normalizedScroll;
        }
        const playbackProgress = clamp(targetTime / masterDuration);
        const activeScene = playbackProgress < 0.085 ? 0 : playbackProgress < 0.17 ? 1 : playbackProgress < 0.44 ? 2 : playbackProgress < 0.71 ? 3 : playbackProgress < 0.95 ? 4 : 5;
        const direction = progress >= storyProgressRef.current ? 1 : -1;
        storyProgressRef.current = progress;
        story.style.setProperty("--story-progress", String(playbackProgress));
        story.style.setProperty("--scroll-direction", String(direction));
        story.style.setProperty("--story-intro", String(clamp((0.13 - progress) / 0.09)));
        story.style.setProperty("--story-interface", String(clamp((progress - 0.035) / 0.08)));
        story.style.setProperty("--end-idle", String(clamp((playbackProgress - 0.71) / 0.18)));
        story.style.setProperty("--final-cta", String(clamp((playbackProgress - 0.95) / 0.04)));
        const hasStarted = progress > 0.08;
        if (storyHasStartedRef.current !== hasStarted) {
          storyHasStartedRef.current = hasStarted;
          setStoryHasStarted(hasStarted);
        }
        if (activeStorySceneRef.current !== activeScene) {
          activeStorySceneRef.current = activeScene;
          setActiveStoryScene(activeScene);
        }
        if (tourVideoReady && video?.duration && rect.bottom > 0 && rect.top < window.innerHeight) {
          if (!hasTakenScrollControlRef.current && progress > 0.006) {
            hasTakenScrollControlRef.current = true;
            scrollStartProgressRef.current = progress;
            setScrollHasTakenControl(true);
            video.pause();
            video.currentTime = 0;
            targetTime = 0.35;
          }
          if (hasTakenScrollControlRef.current) {
            targetVideoTimeRef.current = targetTime;
            requestMotion();
          }
          const shouldEndIdle = progress >= 0.987 && video.currentTime >= video.duration - 0.12;
          if (endingIdleActive !== shouldEndIdle) setEndingIdleActive(shouldEndIdle);
          const ending = endingIdleRef.current;
          if (shouldEndIdle && ending?.duration) {
            const endStart = Math.max(video.duration - ending.duration, 0);
            const idleTime = Math.min(Math.max(targetTime - endStart, 0), Math.max(ending.duration - 0.04, 0));
            if (Math.abs(ending.currentTime - idleTime) > 0.08) ending.currentTime = idleTime;
            void ending.play().catch(() => undefined);
          } else {
            ending?.pause();
          }
        }
        if (progress <= 0.002 && hasTakenScrollControlRef.current) {
          hasTakenScrollControlRef.current = false;
          scrollStartProgressRef.current = null;
          targetVideoTimeRef.current = null;
          tourVideoRef.current?.pause();
          if (tourVideoRef.current) tourVideoRef.current.currentTime = 0;
          setScrollHasTakenControl(false);
          setEndingIdleActive(false);
          endingIdleRef.current?.pause();
        }
      }
    };
    const requestUpdate = () => {
      if (!updateFrame) updateFrame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (updateFrame) window.cancelAnimationFrame(updateFrame);
      if (motionFrameRef.current) {
        window.cancelAnimationFrame(motionFrameRef.current);
        motionFrameRef.current = 0;
      }
    };
  }, [endingIdleActive, tourVideoReady]);

  useEffect(() => {
    if (!tourOpen) return;
    const video = modalVideoRef.current;
    if (!video) return;
    const seekToScene = () => {
      if (video.duration) video.currentTime = Math.min(video.duration * modalSceneProgress[tourScene], Math.max(video.duration - 0.04, 0));
    };
    seekToScene();
    video.addEventListener("loadedmetadata", seekToScene, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekToScene);
  }, [tourOpen, tourScene]);

  useEffect(() => {
    if (!tourOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setTourOpen(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tourOpen]);

  const openTour = (index = 0) => {
    setTourScene(index);
    setTourOpen(true);
  };

  const seekStoryScene = (index: number) => {
    const story = storyRef.current;
    if (!story) return;
    const distance = story.offsetHeight - window.innerHeight;
    window.scrollTo({ top: window.scrollY + story.getBoundingClientRect().top + distance * tourChapters[index].progress, behavior: "smooth" });
  };
  const activeChapter = tourChapters[activeStoryScene];
  const activeDetail = tourChapterDetails[activeStoryScene];

  return (
    <main className={styles.page}>
      <section id="top" ref={storyRef} className={`${styles.story} ${styles.fullPageTour} ${scrollHasTakenControl ? styles.isScrollControlled : ""} ${endingIdleActive ? styles.hasEndingIdle : ""}`} aria-label="Aster House visual walkthrough">
        <div className={styles.storySticky}>
          <div className={styles.storyPoster} aria-hidden="true"><Image src={orbitalPoster} alt="" fill priority sizes="100vw" className={styles.storyImage} /></div>
          <video ref={openingIdleRef} className={styles.openingIdleVideo} src={openingIdleTour} muted loop autoPlay playsInline preload="auto" />
          <video ref={tourVideoRef} className={styles.storyVideo} src={scrollTour} muted playsInline preload="auto" poster={orbitalPoster} onCanPlay={() => setTourVideoReady(true)} onError={() => setTourVideoReady(false)} />
          <video ref={endingIdleRef} className={styles.endingIdleVideo} src={endingIdleTour} muted loop playsInline preload="auto" />
          <header className={styles.tourNav}>
            <Link href="/" className={styles.wordmark} aria-label="Return to Project Hub"><span className={styles.mark}>V</span><span>VERA</span></Link>
            <nav aria-label="Fly-through route"><button onClick={() => seekStoryScene(0)}>The flight</button><button onClick={() => seekStoryScene(2)}>The house</button><button onClick={() => seekStoryScene(5)}>The suite</button></nav>
            <button className={styles.tourNavAction} onClick={() => openTour()}>Open tour <ArrowUpRight aria-hidden="true" /></button>
          </header>
          <div className={styles.storyTopline}><span><i /> Vera collection · featured stay 01 / 12</span><span>Aster House, Milos · scroll to move</span></div>
          <div className={styles.storyIntro}>
            <span><i /> Featured Vera stay · 01 / 12</span>
            <h1>Book the home<br />you can actually<br /><em>explore.</em></h1>
            <p>Aster House is one of 12 available Vera homes. Start above the Aegean, then scroll through the clouds, coast and every important room.</p>
          </div>
          <div className={styles.storyFocus} aria-hidden="true"><i /><i /><i /><i /></div>
          <div className={styles.storyMoveCue} aria-hidden="true"><span>Scroll to move</span><i /></div>
          {storyHasStarted && activeStoryScene < 5 && <article key={activeChapter.id} className={styles.glassTile} aria-live="polite">
              <div className={styles.tileTopline}><span>Featured 01 / 12 · {activeChapter.number} / 06</span><i />{activeChapter.marker}</div>
              <h2>{activeDetail.heading.split("\n").map((line, index) => <span key={line}>{index === 1 ? <em>{line}</em> : line}{index === 0 && <br />}</span>)}</h2>
              <p>{activeDetail.copy}</p>
              <ul>{activeDetail.facts.map((fact) => <li key={fact}><i />{fact}</li>)}</ul>
            </article>}
          <div className={styles.storyProgress} aria-label="Walkthrough scenes">
            {tourChapters.map((chapter, index) => <button key={chapter.id} className={activeStoryScene === index ? styles.activeStoryStep : ""} onClick={() => seekStoryScene(index)} aria-label={`View ${chapter.label}`} aria-current={activeStoryScene === index ? "step" : undefined}><span>{chapter.number}</span><i /><b>{chapter.label}</b></button>)}
          </div>
          <div className={styles.storyStatus}><span>Featured Vera stay · 01 / 12</span><b>Aster House, Milos · {activeChapter.marker}</b><small>{activeChapter.direction}</small></div>
          <div className={styles.finalTourCta}><span>Featured stay · 01 of 12 available Vera homes</span><h2>Stay long enough<br />for the view to become yours.</h2><button onClick={() => openTour(2)}>Explore Aster House <ArrowUpRight aria-hidden="true" /></button></div>
        </div>
      </section>

      {tourOpen && <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Verified visual tour">
        <button className={styles.modalBackdrop} onClick={() => setTourOpen(false)} aria-label="Close tour" />
        <section className={styles.modalPanel}>
          <header><div><span>Verified visual walkthrough</span><h2>Aster House</h2></div><button onClick={() => setTourOpen(false)} aria-label="Close tour"><X /></button></header>
          <div className={styles.modalImage}>{tourVideoReady ? <video ref={modalVideoRef} className={styles.modalVideo} src={scrollTour} poster={scenes[tourScene].image} controls autoPlay muted playsInline /> : <Image src={scenes[tourScene].image} alt={scenes[tourScene].marker} fill sizes="min(94vw, 1180px)" />}<div /><button className={styles.locationPin} onClick={() => setTourScene((tourScene + 1) % scenes.length)}><i />{scenes[tourScene].marker}</button><span>Visual scene {String(tourScene + 1).padStart(2, "0")} / 03</span></div>
          <div className={styles.modalFoot}><div className={styles.sceneTabs}>{scenes.map((scene, index) => <button className={index === tourScene ? styles.activeTab : ""} key={scene.title} onClick={() => setTourScene(index)}><b>0{index + 1}</b>{scene.eyebrow.split("· ")[1]}</button>)}</div><p>{scenes[tourScene].detail}</p><div className={styles.modalArrows}><button onClick={() => setTourScene((tourScene + scenes.length - 1) % scenes.length)} aria-label="Previous scene"><ChevronLeft /></button><button onClick={() => setTourScene((tourScene + 1) % scenes.length)} aria-label="Next scene"><ChevronRight /></button></div></div>
        </section>
      </div>}
    </main>
  );
}
