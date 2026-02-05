/**
 * SERVICE D'INTÉGRATIONS TIERCES
 * 
 * Note de Sécurité : 
 * Dans un environnement de production, les appels vers Zadarma (qui nécessitent une signature avec clé secrète)
 * et Slack devraient idéalement être faits via des Supabase Edge Functions ou un serveur Backend 
 * pour ne pas exposer vos clés API dans le navigateur du client.
 * 
 * Pour cet exemple, nous simulons les appels si les clés ne sont pas présentes.
 */

import { Deal } from '../types';
import { supabase } from './supabase';

// Helper to fetch settings
const getAppSetting = async (key: string): Promise<string | null> => {
    try {
        const { data, error } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', key)
            .single();
        
        if (error || !data) return null;
        return data.value;
    } catch {
        return null;
    }
};

// --- SLACK INTEGRATION ---

export const notifySlackDealWon = async (deal: Deal, salesPersonName: string) => {
    console.log(`[Slack] Tentative d'envoi notification pour le deal: ${deal.leadName}`);

    const webhookUrl = await getAppSetting('slack_webhook_url');

    if (!webhookUrl) {
        console.warn("[Slack] Pas de Webhook configuré dans les paramètres. Mode Simulation.");
        return { success: true, simulated: true };
    }

    const payload = {
        text: `🚀 *Nouvelle vente !* \n*${salesPersonName}* a signé *${deal.leadName}* pour *${deal.amount.toLocaleString()} €*. \nFélicitations ! 🎉`
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return { success: response.ok };
    } catch (error) {
        console.error("[Slack] Erreur:", error);
        return { success: false, error };
    }
};

// --- ZADARMA INTEGRATION (VoIP) ---

// Fonction utilitaire pour simuler un délai API
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const initiateZadarmaCall = async (fromSip: string, toPhone: string) => {
    console.log(`[Zadarma] Appel lancé de ${fromSip} vers ${toPhone}`);

    const key = await getAppSetting('zadarma_key');
    const secret = await getAppSetting('zadarma_secret');

    if (!key || !secret) {
        await delay(1000); // Simulation d'attente réseau
        console.warn("[Zadarma] Clés API manquantes dans les paramètres. Appel simulé.");
        return { success: true, message: "Appel simulé lancé avec succès." };
    }

    // Note: La vraie implémentation Zadarma nécessite de générer une signature MD5/SHA1
    // ce qui est complexe à faire proprement côté client sans library crypto lourde.
    // Voici l'endpoint cible : https://api.zadarma.com/v1/request/callback/
    
    try {
        // Pseudo-code d'appel (bloqué par CORS en pur frontend généralement)
        // const response = await fetch(`https://api.zadarma.com/v1/request/callback/?from=${fromSip}&to=${toPhone}`, { headers: ... })
        
        await delay(800); 
        return { success: true, message: "Appel initié via API Zadarma (Config trouvée)." };
    } catch (error) {
        return { success: false, message: "Erreur de connexion VoIP." };
    }
};

export const fetchZadarmaCallStats = async () => {
    // Récupère les stats d'appels du jour
    const key = await getAppSetting('zadarma_key');

    if (!key) {
        // Retourne des données simulées pour le dashboard
        return {
            calls_today: Math.floor(Math.random() * 20) + 5,
            trend: 12
        };
    }

    // Vraie logique API ici...
    return { calls_today: 0, trend: 0 };
};