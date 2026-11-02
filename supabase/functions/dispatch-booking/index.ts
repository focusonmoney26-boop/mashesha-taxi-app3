import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
serve(async req=>{ if(req.method==='OPTIONS') return new Response('ok',{headers:cors}); try {
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 const {data:{user}}=await userClient.auth.getUser(); if(!user) return new Response('Unauthorized',{status:401,headers:cors});
 const {data:profile}=await admin.from('profiles').select('role,approved').eq('id',user.id).single(); if(!profile||profile.role!=='passenger') return new Response('Passenger account required',{status:403,headers:cors});
 const body=await req.json(); const {data:booking,error}=await admin.from('bookings').insert({passenger_id:user.id,origin:body.origin,destination:body.destination,ride_type:body.ride_type,pickup_at:body.pickup_at,base_fare_zar:body.base_fare_zar,payment_method:body.payment_method||'cash',payment_status:'unpaid'}).select().single(); if(error) throw error;
 const {data:drivers}=await admin.from('profiles').select('id').eq('role','driver').eq('approved',true); const ids=(drivers||[]).map((d:any)=>d.id);
 if(ids.length){const {error:e}=await admin.from('booking_offers').insert(ids.map((driver_id:string)=>({booking_id:booking.id,driver_id})));if(e)throw e;} else await admin.from('bookings').update({status:'no_driver'}).eq('id',booking.id);
 return Response.json({booking_id:booking.id,offers_sent:ids.length},{headers:cors});
 }catch(e){return Response.json({error:String(e)},{status:400,headers:cors});}});
