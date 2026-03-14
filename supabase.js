const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  "sb_publishable_IGQ2rXd8K28WVrXFIWu-Sw_IjoW0lip",
  "https://lggezprkqbhjooqsbzfi.supabase.co"
)

module.exports = supabase