-- Add description column to offerings table
-- This script should be run in the Supabase SQL Editor

ALTER TABLE offerings 
ADD COLUMN description TEXT;

-- Add some sample descriptions for testing (optional)
-- You can uncomment and modify these as needed:

-- UPDATE offerings 
-- SET description = 'Join us for a rejuvenating social sauna session where you can unwind and connect with others in our authentic Finnish sauna.\n\nPerfect for beginners and experienced sauna-goers alike. Come as you are and leave refreshed!'
-- WHERE session_type = 'social';

-- UPDATE offerings 
-- SET description = 'Experience the meditative power of silence in our peaceful sauna environment.\n\nThis session is designed for personal reflection and deep relaxation. No conversation - just pure tranquility.'
-- WHERE session_type = 'silent';

-- UPDATE offerings 
-- SET description = 'Led by our experienced sauna masters, this guided session includes traditional rituals and breathing techniques.\n\nLearn the art of proper sauna etiquette while experiencing the full benefits of heat therapy.'
-- WHERE session_type = 'guided';