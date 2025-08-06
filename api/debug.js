/**
 * Debug endpoint to check environment variables
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const debug = {
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    
    // Pour debug - ne pas laisser en prod !
    supabaseUrlStart: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + '...' : 'NOT_SET',
    supabaseKeyStart: process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'NOT_SET'
  };
  
  res.status(200).json(debug);
}