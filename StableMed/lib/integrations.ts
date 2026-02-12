/**
 * SERVICE D'INTÉGRATIONS TIERCES
 * 
 * Note de Sécurité : 
 * Dans un environnement de production, les appels vers Zadarma (qui nécessitent une signature avec clé secrète)
 * devraient idéalement être faits via des Supabase Edge Functions ou un serveur Backend 
 * pour ne pas exposer vos clés API dans le navigateur du client.
 * 
 * Cette version client est volontairement "safe": aucun secret n'est lu côté navigateur.
 * Les appels sont simulés tant qu'une implémentation backend sécurisée n'est pas branchée.
 */

// --- ZADARMA INTEGRATION (VoIP) ---

// Fonction utilitaire pour simuler un délai API
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const initiateZadarmaCall = async (fromSip: string, toPhone: string) => {
    console.log(`[Zadarma] Appel lancé de ${fromSip} vers ${toPhone}`);
    void fromSip;
    void toPhone;
    await delay(900);
    return { success: true, message: "Appel simule lance avec succes." };
};

export const fetchZadarmaCallStats = async () => {
    const daySeed = new Date().toISOString().slice(0, 10);
    const hash = Array.from(daySeed).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return {
        calls_today: (hash % 16) + 8,
        trend: (hash % 21) - 5,
    };
};
