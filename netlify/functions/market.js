exports.handler = async (event) => {
  const target = event.queryStringParameters?.url;
  if (!target || !target.startsWith('https://query1.finance.yahoo.com/')) return { statusCode: 400, body: '{"error":"Invalid request"}' };
  try {
    const response = await fetch(target, { headers: { 'User-Agent': 'MarketPulse/1.0' } });
    return { statusCode: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }, body: await response.text() };
  } catch { return { statusCode: 502, body: '{"error":"Provider unavailable"}' }; }
};
