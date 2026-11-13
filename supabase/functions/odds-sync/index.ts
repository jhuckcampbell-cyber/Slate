import { createClient } from "npm:@supabase/supabase-js@2";
import { createOddsHandler } from "./engine.ts";

Deno.serve(createOddsHandler(createClient, Deno.env));
