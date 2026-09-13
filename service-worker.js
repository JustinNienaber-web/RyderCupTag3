"use strict";

const CACHE_NAME = "rydercup-tag3-v2";
const SUPABASE_BIBLIOTHEK =
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

const APP_DATEIEN = [
    "./",
    "./index.html",
    "./style.css?v=2",
    "./config.js",
    "./platzdaten.js",
    "./sync.js",
    "./app.js?v=2",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await cache.addAll(APP_DATEIEN);
            const antwort = await fetch(
                new Request(SUPABASE_BIBLIOTHEK, { mode: "no-cors" })
            );
            await cache.put(SUPABASE_BIBLIOTHEK, antwort);
        })
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((namen) => Promise.all(
            namen
                .filter((name) => name.startsWith("rydercup-tag3-") && name !== CACHE_NAME)
                .map((name) => caches.delete(name))
        ))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const anfrage = event.request;
    const url = new URL(anfrage.url);

    if (anfrage.method !== "GET") return;
    if (url.hostname.endsWith("supabase.co")) return;

    if (url.origin !== self.location.origin) {
        event.respondWith(
            caches.match(anfrage).then((gespeichert) => gespeichert || fetch(anfrage))
        );
        return;
    }

    event.respondWith((async () => {
        try {
            const antwort = await fetch(anfrage, { cache: "no-store" });
            if (antwort.ok) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(anfrage, antwort.clone());
            }
            return antwort;
        } catch (fehler) {
            const gespeichert = await caches.match(anfrage);
            if (gespeichert) return gespeichert;
            if (anfrage.mode === "navigate") return caches.match("./index.html");
            throw fehler;
        }
    })());
});
