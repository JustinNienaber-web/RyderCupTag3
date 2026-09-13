"use strict";

const SUPABASE_ZUSTAND = (() => {
    const client = supabase.createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.publishableKey
    );

    async function ladeMatch(matchNummer, bearbeitungsToken) {
        const { data, error } = await client.rpc("get_tag3_match", {
            p_match_number: matchNummer,
            p_edit_token: bearbeitungsToken,
        });

        if (error) {
            throw new Error(`Match ${matchNummer} konnte nicht geladen werden: ${error.message}`);
        }

        return data;
    }

    async function speichereMatch(matchNummer, bearbeitungsToken, zustand) {
        const { data, error } = await client.rpc("save_tag3_match_state", {
            p_match_number: matchNummer,
            p_edit_token: bearbeitungsToken,
            p_state: zustand,
        });

        if (error) {
            throw new Error(`Match ${matchNummer} konnte nicht gespeichert werden: ${error.message}`);
        }

        return data;
    }

    async function ladeLeaderboard(anzeigeToken) {
        const { data, error } = await client.rpc("get_tag3_leaderboard", {
            p_view_token: anzeigeToken,
        });

        if (error) {
            throw new Error(`Leaderboard konnte nicht geladen werden: ${error.message}`);
        }

        return data;
    }

    return Object.freeze({
        ladeMatch,
        speichereMatch,
        ladeLeaderboard,
    });
})();
