"use strict";

const hauptkarte = document.getElementById("hauptkarte");
let aktivesMatch = null;
let token = "";
let runde = null;
let rueckkehrLoch = null;
let liveMatches = [];
let leaderboardToken = "";
let leaderboardIntervall = null;

function statusAnzeigen(nachricht, art = "online") {
    let anzeige = document.getElementById("netzstatus");

    if (!anzeige) {
        anzeige = document.createElement("div");
        anzeige.id = "netzstatus";
        anzeige.className = "netzstatus";
        document.body.appendChild(anzeige);
    }

    anzeige.textContent = nachricht;
    anzeige.className = `netzstatus netzstatus-${art}`;
}

function verbindungsstatusAnzeigen() {
    if (navigator.onLine) {
        statusAnzeigen("Online", "online");
    } else {
        statusAnzeigen("Offline · lokal gespeichert", "offline");
    }
}

function statusUnterLochbuttonPlatzieren() {
    verbindungsstatusAnzeigen();
    const anzeige = document.getElementById("netzstatus");
    if (anzeige) {
        hauptkarte.appendChild(anzeige);
    }
}

function text(wert) {
    return String(wert ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function startzeit(zeit) {
    return String(zeit ?? "").slice(0, 5);
}

function laeuftAlsInstallierteApp() {
    return window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
}

function geraetezuordnungLaden() {
    try {
        const gespeichert = localStorage.getItem("rydercup-tag3-geraetezuordnung");
        return gespeichert ? JSON.parse(gespeichert) : null;
    } catch (fehler) {
        console.warn("Gerätezuordnung war nicht lesbar.", fehler);
        return null;
    }
}

function geraetezuordnungSpeichern(nummer, bearbeitungsToken) {
    localStorage.setItem(
        "rydercup-tag3-geraetezuordnung",
        JSON.stringify({ nummer, token: bearbeitungsToken })
    );
}

function linkdaten() {
    const parameter = new URLSearchParams(location.search);
    const nummer = Number(parameter.get("match"));
    const bearbeitungsToken = parameter.get("token")?.trim() ?? "";
    const anzeigeToken = parameter.get("leaderboard")?.trim() ?? "";
    const gueltigeNummer = Number.isInteger(nummer) && nummer >= 1 && nummer <= 15;

    if (gueltigeNummer && bearbeitungsToken) {
        geraetezuordnungSpeichern(nummer, bearbeitungsToken);
        return { nummer, token: bearbeitungsToken, leaderboard: "" };
    }

    if (laeuftAlsInstallierteApp()) {
        const zuordnung = geraetezuordnungLaden();
        if (zuordnung?.nummer && zuordnung?.token) {
            return { ...zuordnung, leaderboard: "" };
        }
    }

    return {
        nummer: gueltigeNummer ? nummer : null,
        token: bearbeitungsToken,
        leaderboard: anzeigeToken,
    };
}

function namen(spieler) {
    return spieler.map((person) => text(person.name)).join(" & ");
}

function spielerliste(match) {
    return [
        ...match.red_players.map((person, index) => ({ ...person, id: `red-${index}`, team: "red" })),
        ...match.purple_players.map((person, index) => ({ ...person, id: `purple-${index}`, team: "purple" })),
    ];
}

function schlaegeAufLoch(vorgabe, lochHcp) {
    const grundschlaege = Math.floor(vorgabe / 18);
    const rest = vorgabe % 18;
    return grundschlaege + (lochHcp <= rest ? 1 : 0);
}

function neuerZustand() {
    return {
        status: "in_progress",
        currentHole: 1,
        completedHoles: [],
        scores: {},
        matchLead: 0,
        winner: null,
        resultText: null,
    };
}

function speicherschluessel() {
    return `rydercup-tag3-match-${aktivesMatch.match_number}`;
}

function matchschluessel(matchNummer) {
    return `rydercup-tag3-matchdaten-${matchNummer}`;
}

function matchdatenLokalSpeichern(match) {
    localStorage.setItem(
        matchschluessel(match.match_number),
        JSON.stringify(match)
    );
}

function matchdatenLokalLaden(matchNummer) {
    try {
        const gespeichert = localStorage.getItem(matchschluessel(matchNummer));
        return gespeichert ? JSON.parse(gespeichert) : null;
    } catch (fehler) {
        console.warn("Lokale Matchdaten waren nicht lesbar.", fehler);
        return null;
    }
}

function lokalSpeichern() {
    localStorage.setItem(speicherschluessel(), JSON.stringify(runde));
}

function lokalenZustandLaden() {
    try {
        const gespeichert = localStorage.getItem(speicherschluessel());
        return gespeichert ? JSON.parse(gespeichert) : null;
    } catch (fehler) {
        console.warn("Lokaler Spielstand war nicht lesbar.", fehler);
        return null;
    }
}

function istLaufendeRunde(zustand) {
    return zustand && ["in_progress", "finished"].includes(zustand.status);
}

async function onlineSpeichern() {
    if (!navigator.onLine) {
        runde.syncPending = true;
        lokalSpeichern();
        statusAnzeigen("Offline · lokal gespeichert", "offline");
        return;
    }

    statusAnzeigen("Wird gespeichert …", "speichert");

    try {
        await SUPABASE_ZUSTAND.speichereMatch(
            aktivesMatch.match_number,
            token,
            runde
        );
        runde.syncPending = false;
        lokalSpeichern();
        statusAnzeigen("Online · gespeichert", "online");
    } catch (fehler) {
        runde.syncPending = true;
        lokalSpeichern();
        statusAnzeigen("Offline · lokal gespeichert", "offline");
        console.warn("Spielstand bleibt lokal gespeichert.", fehler);
    }
}

function standText() {
    if (runde.matchLead === 0) return "Even";
    const team = runde.matchLead > 0 ? "RED" : "PURPLE";
    return `${team} ${Math.abs(runde.matchLead)} auf`;
}

function standNeuBerechnen() {
    runde.matchLead = runde.completedHoles.reduce((stand, eintrag) => {
        if (eintrag.winner === "red") return stand + 1;
        if (eintrag.winner === "purple") return stand - 1;
        return stand;
    }, 0);
}

function scoresFuerLoch(lochNummer) {
    const key = String(lochNummer);
    if (!runde.scores[key]) {
        const loch = PLATZ.loecher[lochNummer - 1];
        runde.scores[key] = {};
        for (const person of spielerliste(aktivesMatch)) {
            runde.scores[key][person.id] = loch.par + schlaegeAufLoch(
                person.courseHandicap,
                loch.hcp
            );
        }
    }
    return runde.scores[key];
}

function netto(person, brutto, loch) {
    return brutto - schlaegeAufLoch(person.zockHandicap, loch.hcp);
}

function aggregate() {
    const loch = PLATZ.loecher[runde.currentHole - 1];
    const scores = scoresFuerLoch(runde.currentHole);
    const ergebnis = { red: 0, purple: 0 };
    for (const person of spielerliste(aktivesMatch)) {
        ergebnis[person.team] += netto(person, scores[person.id], loch);
    }
    return ergebnis;
}

function spielerkarte(person, loch, score) {
    const vorgabeIstAktiv = schlaegeAufLoch(
        person.zockHandicap,
        loch.hcp
    ) > 0;

    return `
        <article class="score-karte">
            <div class="spieler-kopf">
                <strong>${text(person.name)}</strong>
                <span>
                    Vorgabe
                    <b class="${vorgabeIstAktiv ? "vorgabe-aktiv" : ""}">
                        ${person.zockHandicap}
                    </b>
                </span>
            </div>
            <div class="score-eingabe">
                <button class="score-button" type="button" data-id="${person.id}" data-richtung="minus">−</button>
                <output id="score-${person.id}">${score}</output>
                <button class="score-button" type="button" data-id="${person.id}" data-richtung="plus">+</button>
            </div>
        </article>
    `;
}

function teamblock(team, personen, loch, scores, wert) {
    return `
        <section class="loch-team loch-team-${team}" id="team-${team}">
            ${personen.map((person) => spielerkarte(person, loch, scores[person.id])).join("")}
            <div class="aggregat-zeile">
                <span>Netto</span>
                <strong id="aggregat-${team}">${wert}</strong>
            </div>
        </section>
    `;
}

function vorschauAktualisieren() {
    const wert = aggregate();
    document.getElementById("aggregat-red").textContent = wert.red;
    document.getElementById("aggregat-purple").textContent = wert.purple;
    document.getElementById("team-red").classList.toggle("team-fuehrt", wert.red < wert.purple);
    document.getElementById("team-purple").classList.toggle("team-fuehrt", wert.purple < wert.red);
}

function lochAnzeigen() {
    document.body.classList.add("eingabe-modus");
    const loch = PLATZ.loecher[runde.currentHole - 1];
    const scores = scoresFuerLoch(runde.currentHole);
    const personen = spielerliste(aktivesMatch);
    const wert = aggregate();
    hauptkarte.innerHTML = `
        <div class="loch-kopf">
            <div>
                <p class="ueberzeile">Match ${aktivesMatch.match_number}</p>
                <button class="bahn-titel" type="button" id="bahnauswahl-oeffnen">
                    Bahn ${loch.nummer}<span aria-hidden="true">⌄</span>
                </button>
            </div>
            <div class="loch-kopf-rechts">
                <strong class="match-stand">${standText()}</strong>
                <div class="loch-daten"><span>Par ${loch.par}</span><span>HCP ${loch.hcp}</span></div>
            </div>
        </div>
        <div class="loch-teams">
            ${teamblock("red", personen.filter((p) => p.team === "red"), loch, scores, wert.red)}
            ${teamblock("purple", personen.filter((p) => p.team === "purple"), loch, scores, wert.purple)}
        </div>
        <button class="primaer-button" type="button" id="weiter">
            ${rueckkehrLoch !== null
                ? `Änderung speichern und zurück zu Bahn ${rueckkehrLoch}`
                : loch.nummer === 18
                    ? "Match beenden"
                    : `Weiter zu Bahn ${loch.nummer + 1}`}
        </button>
    `;

    document.querySelectorAll(".score-button").forEach((button) => {
        button.addEventListener("click", () => {
            const aenderung = button.dataset.richtung === "plus" ? 1 : -1;
            scores[button.dataset.id] = Math.max(1, scores[button.dataset.id] + aenderung);
            document.getElementById(`score-${button.dataset.id}`).textContent = scores[button.dataset.id];
            lokalSpeichern();
            vorschauAktualisieren();
        });
    });

    document.getElementById("bahnauswahl-oeffnen").addEventListener("click", bahnauswahlAnzeigen);
    document.getElementById("weiter").addEventListener("click", lochAbschliessen);
    vorschauAktualisieren();
    statusUnterLochbuttonPlatzieren();
}

function bahnButtons(von, bis, titel) {
    const abgeschlossen = new Set(runde.completedHoles.map((eintrag) => eintrag.hole));
    let buttons = "";

    for (let nummer = von; nummer <= bis; nummer += 1) {
        const istAktuell = nummer === runde.currentHole;
        const darfOeffnen = istAktuell || abgeschlossen.has(nummer);
        buttons += `
            <button
                class="bahn-button ${istAktuell ? "bahn-aktuell" : ""} ${abgeschlossen.has(nummer) ? "bahn-fertig" : ""}"
                type="button"
                data-bahn="${nummer}"
                ${darfOeffnen ? "" : "disabled"}
            >${nummer}</button>
        `;
    }

    return `<section class="bahn-gruppe"><h3>${titel}</h3><div class="bahn-raster">${buttons}</div></section>`;
}

function bahnauswahlAnzeigen() {
    document.body.classList.add("eingabe-modus");
    hauptkarte.innerHTML = `
        <p class="ueberzeile">Match ${aktivesMatch.match_number}</p>
        <h2>Gehe zu Bahn</h2>
        <div class="bahn-auswahl">
            ${bahnButtons(1, 9, "Front 9")}
            ${bahnButtons(10, 18, "Back 9")}
        </div>
        <button class="sekundaer-button" type="button" id="auswahl-abbrechen">Abbrechen</button>
    `;

    document.querySelectorAll(".bahn-button:not(:disabled)").forEach((button) => {
        button.addEventListener("click", () => {
            const ziel = Number(button.dataset.bahn);
            if (ziel !== runde.currentHole && rueckkehrLoch === null) {
                rueckkehrLoch = runde.currentHole;
            }
            runde.currentHole = ziel;
            lochAnzeigen();
        });
    });

    document.getElementById("auswahl-abbrechen").addEventListener("click", lochAnzeigen);
}

function ergebnisAnzeigen() {
    document.body.classList.remove("eingabe-modus");
    const siegername = runde.winner === "red"
        ? TURNIER_CONFIG.redTeam
        : runde.winner === "purple"
            ? TURNIER_CONFIG.purpleTeam
            : "Match geteilt";

    hauptkarte.innerHTML = `
        <p class="ueberzeile">Match ${aktivesMatch.match_number} beendet</p>
        <h2>${text(siegername)}</h2>
        <div class="endstand">${text(runde.resultText)}</div>
        <div class="team-uebersicht kompakt">
            <section class="team-block team-rot"><span>${TURNIER_CONFIG.redTeam}</span><strong>${namen(aktivesMatch.red_players)}</strong></section>
            <section class="team-block team-violett"><span>${TURNIER_CONFIG.purpleTeam}</span><strong>${namen(aktivesMatch.purple_players)}</strong></section>
        </div>
        <button class="sekundaer-button endmaske-scorecard" type="button" id="scorecard-anzeigen">
            Scorecard anzeigen
        </button>
        <button class="sekundaer-button endmaske-zurueck" type="button" id="zurueck-zur-eingabe">
            Zurück zur Eingabe
        </button>
    `;

    document.getElementById("scorecard-anzeigen").addEventListener("click", scorecardAnzeigen);

    document.getElementById("zurueck-zur-eingabe").addEventListener("click", () => {
        const letztesLoch = runde.completedHoles.reduce(
            (hoechstes, eintrag) => Math.max(hoechstes, eintrag.hole),
            1
        );

        runde.completedHoles = runde.completedHoles.filter(
            (eintrag) => eintrag.hole !== letztesLoch
        );
        runde.currentHole = letztesLoch;
        runde.status = "in_progress";
        runde.winner = null;
        runde.resultText = null;
        standNeuBerechnen();
        lokalSpeichern();
        void onlineSpeichern();
        lochAnzeigen();
    });
}

function scorecardAnzeigen() {
    document.body.classList.remove("eingabe-modus");
    const personen = spielerliste(aktivesMatch);
    const abgeschlosseneLoecher = new Map(
        runde.completedHoles.map((eintrag) => [eintrag.hole, eintrag])
    );

    const zeilen = PLATZ.loecher.map((loch) => {
        const ergebnis = abgeschlosseneLoecher.get(loch.nummer);
        const scores = ergebnis ? runde.scores[String(loch.nummer)] : null;
        const punkt = !ergebnis
            ? ""
            : ergebnis.winner === "red"
                ? "R"
                : ergebnis.winner === "purple"
                    ? "P"
                    : "–";

        return `
            <tr>
                <th scope="row">${loch.nummer}</th>
                <td>${loch.par}</td>
                ${personen.map((person) => `<td>${scores ? scores[person.id] : ""}</td>`).join("")}
                <td class="summe-rot">${ergebnis?.redAggregate ?? ""}</td>
                <td class="summe-purple">${ergebnis?.purpleAggregate ?? ""}</td>
                <td>${punkt}</td>
            </tr>
        `;
    }).join("");

    hauptkarte.innerHTML = `
        <p class="ueberzeile">Match ${aktivesMatch.match_number}</p>
        <h2>Scorecard</h2>

        <div class="scorecard-scroll">
            <table class="scorecard">
                <thead>
                    <tr>
                        <th>Bahn</th>
                        <th>Par</th>
                        <th>R</th>
                        <th>P</th>
                        <th class="summe-rot">R Netto</th>
                        <th class="summe-purple">P Netto</th>
                        <th>Pkt.</th>
                    </tr>
                </thead>
                <tbody>${zeilen}</tbody>
            </table>
        </div>

        <div class="scorecard-legende">
            <p><b>R</b> ${text(personen[0].name)}</p>
            <p><b>P</b> ${text(personen[1].name)}</p>
            <small>Punkt: R, P oder geteilt (–)</small>
        </div>

        <button class="primaer-button" type="button" id="zurueck-zum-ergebnis">
            Zurück zum Ergebnis
        </button>
    `;

    document.getElementById("zurueck-zum-ergebnis").addEventListener("click", ergebnisAnzeigen);
}

function lochAbschliessen() {
    const lochNummer = runde.currentHole;
    const wert = aggregate();
    let gewinner = "tie";

    if (wert.red < wert.purple) {
        gewinner = "red";
    } else if (wert.purple < wert.red) {
        gewinner = "purple";
    }

    const bestehenderIndex = runde.completedHoles.findIndex(
        (eintrag) => eintrag.hole === lochNummer
    );
    const eintrag = {
        hole: lochNummer,
        winner: gewinner,
        redAggregate: wert.red,
        purpleAggregate: wert.purple,
    };

    if (bestehenderIndex >= 0) {
        runde.completedHoles[bestehenderIndex] = eintrag;
    } else {
        runde.completedHoles.push(eintrag);
    }

    standNeuBerechnen();

    if (rueckkehrLoch !== null) {
        runde.currentHole = rueckkehrLoch;
        rueckkehrLoch = null;
        lokalSpeichern();
        void onlineSpeichern();
        lochAnzeigen();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }

    const verbleibend = 18 - runde.completedHoles.length;
    const fuehrung = Math.abs(runde.matchLead);
    const vorzeitigBeendet = fuehrung > verbleibend;
    const nachLoch18 = lochNummer === 18;

    if (vorzeitigBeendet || nachLoch18) {
        runde.status = "finished";
        runde.winner = runde.matchLead > 0
            ? "red"
            : runde.matchLead < 0
                ? "purple"
                : "tie";
        runde.resultText = vorzeitigBeendet
            ? `${fuehrung} & ${verbleibend}`
            : runde.matchLead === 0
                ? "Geteilt"
                : `${fuehrung} auf`;
        lokalSpeichern();
        void onlineSpeichern();
        ergebnisAnzeigen();
        return;
    }

    runde.currentHole += 1;
    lokalSpeichern();
    void onlineSpeichern();
    lochAnzeigen();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function matchstart(match) {
    document.body.classList.remove("eingabe-modus");
    const lokal = lokalenZustandLaden();
    const zentral = match.state;
    const fortsetzbarerZustand = istLaufendeRunde(lokal)
        ? lokal
        : istLaufendeRunde(zentral)
            ? zentral
            : null;

    hauptkarte.innerHTML = `
        <p class="ueberzeile">Match ${match.match_number}</p>
        <h2>${startzeit(match.start_time)} Uhr · Tee ${match.tee}</h2>
        <div class="team-uebersicht">
            <section class="team-block team-rot"><span>${TURNIER_CONFIG.redTeam}</span><strong>${namen(match.red_players)}</strong></section>
            <div class="gegen">gegen</div>
            <section class="team-block team-violett"><span>${TURNIER_CONFIG.purpleTeam}</span><strong>${namen(match.purple_players)}</strong></section>
        </div>
        ${token ? `
            <button class="primaer-button" type="button" id="start">
                ${fortsetzbarerZustand ? "Match fortsetzen" : "Match starten"}
            </button>
            ${fortsetzbarerZustand ? `
                <button class="gefahr-button" type="button" id="match-neu-starten">
                    Match vollständig neu starten
                </button>
            ` : ""}
        ` : '<div class="hinweis-box">Bitte verwende den QR-Code dieses Matches.</div>'}
    `;
    if (token) {
        document.getElementById("start").addEventListener("click", () => {
            runde = fortsetzbarerZustand ?? neuerZustand();
            if (runde.status === "finished") {
                ergebnisAnzeigen();
            } else {
                lokalSpeichern();
                void onlineSpeichern();
                lochAnzeigen();
            }
        });

        const neuStarten = document.getElementById("match-neu-starten");
        if (neuStarten) {
            neuStarten.addEventListener("click", () => {
                const bestaetigt = window.confirm(
                    "Wirklich neu starten? Alle bisherigen Scores und das Ergebnis dieses Matches werden gelöscht."
                );

                if (!bestaetigt) return;

                runde = {
                    ...neuerZustand(),
                    status: "not_started",
                };
                rueckkehrLoch = null;
                aktivesMatch.state = runde;
                lokalSpeichern();
                void onlineSpeichern();
                matchstart(aktivesMatch);
            });
        }
    }
}

function matchStatus(match) {
    const zustand = match.state ?? {};
    const gespielt = Array.isArray(zustand.completedHoles)
        ? zustand.completedHoles.length
        : 0;

    if (zustand.status === "finished") {
        if (zustand.winner === "tie") return "Geteilt · beendet";
        const team = zustand.winner === "red" ? "RED" : "PURPLE";
        return `${team} ${zustand.resultText ?? "gewinnt"} · beendet`;
    }

    if (zustand.status === "in_progress") {
        const fuehrung = Number(zustand.matchLead ?? 0);
        if (fuehrung === 0) return `Even nach ${gespielt}`;
        const team = fuehrung > 0 ? "RED" : "PURPLE";
        return `${team} ${Math.abs(fuehrung)} auf nach ${gespielt}`;
    }

    return "Noch nicht gestartet";
}

function gesamtpunkte(matches, nurBeendet) {
    return matches.reduce((punkte, match) => {
        const zustand = match.state ?? {};

        if (zustand.status === "finished") {
            if (zustand.winner === "red") punkte.red += 1;
            else if (zustand.winner === "purple") punkte.purple += 1;
            else {
                punkte.red += 0.5;
                punkte.purple += 0.5;
            }
        } else if (!nurBeendet && zustand.status === "in_progress") {
            const fuehrung = Number(zustand.matchLead ?? 0);
            if (fuehrung > 0) punkte.red += 1;
            else if (fuehrung < 0) punkte.purple += 1;
            else {
                punkte.red += 0.5;
                punkte.purple += 0.5;
            }
        }

        return punkte;
    }, {
        red: TURNIER_CONFIG.startstand.red,
        purple: TURNIER_CONFIG.startstand.purple,
    });
}

function punktzahl(wert) {
    return Number.isInteger(wert) ? String(wert) : String(wert).replace(".", ",");
}

function leaderboard(matches) {
    document.body.classList.remove("eingabe-modus");
    document.body.classList.add("leaderboard-modus");
    const prognose = gesamtpunkte(matches, false);
    const offiziell = gesamtpunkte(matches, true);

    hauptkarte.innerHTML = `
        <p class="ueberzeile">Live-Übersicht</p>
        <h2>${TURNIER_CONFIG.redTeam} gegen ${TURNIER_CONFIG.purpleTeam}</h2>
        <p class="datum">${TURNIER_CONFIG.datum}</p>

        <section class="live-gesamtstand">
            <p>Aktueller Gesamtstand</p>
            <div class="gesamtstand-zeile">
                <div class="gesamt-team gesamt-red">
                    <span>RED TIGERS</span>
                    <strong>${punktzahl(prognose.red)}</strong>
                </div>
                <span class="gesamt-trenner">:</span>
                <div class="gesamt-team gesamt-purple">
                    <strong>${punktzahl(prognose.purple)}</strong>
                    <span>PURPLE VIPERS</span>
                </div>
            </div>
            <small>
                Offiziell beendete Matches:
                ${punktzahl(offiziell.red)} : ${punktzahl(offiziell.purple)}
            </small>
        </section>

        <div class="match-liste">
            ${matches.map((match) => `
                <article class="match-zeile status-${match.state?.status ?? "not_started"}">
                    <div><strong>Match ${match.match_number}</strong><span>${startzeit(match.start_time)} Uhr</span></div>
                    <p class="leaderboard-spieler">
                        <span class="leaderboard-red">${namen(match.red_players)}</span>
                        <span class="gegen-klein">gegen</span>
                        <span class="leaderboard-purple">${namen(match.purple_players)}</span>
                    </p>
                    <span class="status-pill">${text(matchStatus(match))}</span>
                </article>
            `).join("")}
        </div>
    `;
}

async function leaderboardAktualisieren() {
    try {
        liveMatches = await SUPABASE_ZUSTAND.ladeLeaderboard(leaderboardToken);
        leaderboard(liveMatches);
    } catch (fehler) {
        console.error(fehler);
        if (liveMatches.length === 0) fehlerAnzeigen(fehler);
    }
}

function fehlerAnzeigen(fehler) {
    hauptkarte.innerHTML = `<h2>Verbindung nicht möglich</h2><p>${text(fehler.message)}</p>`;
}

async function starten() {
    const link = linkdaten();
    token = link.token;
    leaderboardToken = link.leaderboard;

    try {
        if (link.nummer) {
            aktivesMatch = await SUPABASE_ZUSTAND.ladeMatch(link.nummer, token);
            matchdatenLokalSpeichern(aktivesMatch);
            matchstart(aktivesMatch);
        } else if (leaderboardToken) {
            await leaderboardAktualisieren();
            leaderboardIntervall = window.setInterval(leaderboardAktualisieren, 5000);
        } else {
            hauptkarte.innerHTML = `
                <h2>Kein Zugriff</h2>
                <p>Bitte verwende deinen persönlichen Match- oder Leaderboard-Link.</p>
            `;
        }
    } catch (fehler) {
        console.error(fehler);

        if (link.nummer) {
            const lokalesMatch = matchdatenLokalLaden(link.nummer);

            if (lokalesMatch) {
                aktivesMatch = lokalesMatch;
                matchstart(aktivesMatch);
                return;
            }
        }

        fehlerAnzeigen(fehler);
    }
}

window.addEventListener("online", () => {
    verbindungsstatusAnzeigen();
    if (runde?.syncPending && aktivesMatch && token) {
        void onlineSpeichern();
    }
});

window.addEventListener("offline", verbindungsstatusAnzeigen);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(
            "./service-worker.js",
            { updateViaCache: "none" }
        ).then((registrierung) => registrierung.update()).catch((fehler) => {
            console.warn("Offline-Dienst konnte nicht aktiviert werden.", fehler);
        });
    });
}

starten();
verbindungsstatusAnzeigen();
