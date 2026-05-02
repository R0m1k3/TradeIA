import { FastifyPluginAsync } from 'fastify';
import { getMarketContext } from '../data/finnhub';

function getNasdaqStatus(): { isOpen: boolean; nextOpen: string; nextClose: string } {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etNow.getDay();
  const h = etNow.getHours();
  const m = etNow.getMinutes();
  const time = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = isWeekday && time >= 570 && time < 960; // 9:30-16:00 ET

  let nextOpen: string;
  let nextClose: string;

  if (isMarketHours) {
    nextOpen = '';
    nextClose = "Clôture à 16h00 HE";
  } else {
    const minutesToOpen = (() => {
      if (!isWeekday) {
        // Weekend: days until Monday
        const daysToMonday = day === 0 ? 1 : day === 6 ? 2 : 0;
        return daysToMonday * 24 * 60 + (570 - time);
      }
      if (time < 570) return 570 - time; // Before open today
      return (24 * 60 - time) + 570 + (day === 5 ? 2 * 24 * 60 : 0); // After close, or Friday
    })();
    const hours = Math.floor(minutesToOpen / 60);
    const mins = minutesToOpen % 60;
    nextOpen = hours > 0 ? `Ouvre dans ${hours}h${mins > 0 ? ` ${mins}min` : ''}` : `Ouvre dans ${mins}min`;
    nextClose = '';
  }

  return { isOpen: isMarketHours, nextOpen, nextClose };
}

const marketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/context', async () => {
    const context = await getMarketContext();
    const nasdaq = getNasdaqStatus();
    return {
      vix: context.vix,
      fear_greed: context.fear_greed,
      nasdaq: context.nasdaq_direction,
      nasdaq_status: nasdaq,
    };
  });
};

export default marketRoutes;