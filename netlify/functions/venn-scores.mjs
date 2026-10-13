// Venn global results endpoint: /.netlify/functions/venn-scores
// POST { date, playerId, stack, hints } to submit a solve; GET ?date=YYYY-MM-DD for counts.
// The logic lives in netlify/venn/scores.mjs; this file connects it to Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { handleRequest } from '../venn/scores.mjs';

export default async (req) =>
  handleRequest(req, {
    players: getStore({ name: 'venn-players', consistency: 'strong' }),
    scores: getStore({ name: 'venn-scores', consistency: 'strong' }),
  });
