import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, Pressable, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const C = { cream:'#F5EEDB', paper:'#FCF8ED', ink:'#28170F', orange:'#F4AC32', red:'#C94B2D', green:'#225940', muted:'#786257', line:'#28170F' };
const routes = ['Phuthaditjhaba CBD','Tseki','Namahadi','Bluegumbosch','Kestell','Harrismith','Makwane','Mabolela'];
const baseFares: Record<string,number> = { Share:39, Solo:66, Kombi:122 };
const money = (n:number) => `R${n}`;

function Pill({label,active,onPress}:{label:string,active:boolean,onPress:()=>void}) {
 return <Pressable onPress={onPress} style={{paddingVertical:11,paddingHorizontal:15,borderRadius:24,borderWidth:2,borderColor:C.ink,backgroundColor:active?C.orange:C.paper,marginRight:8}}>
  <Text style={{fontWeight:'800',color:C.ink}}>{label}</Text>
 </Pressable>;
}
function Field({label,value,onChange,placeholder}:{label:string,value:string,onChange:(s:string)=>void,placeholder:string}) {
 return <View style={{marginTop:14}}>
  <Text style={{fontSize:12,fontWeight:'900',letterSpacing:1.6,color:C.muted,marginBottom:7}}>{label}</Text>
  <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#A99A8C" style={{fontSize:19,fontWeight:'800',color:C.ink,borderBottomWidth:1,borderColor:'#D7CABB',paddingVertical:8}} />
 </View>;
}
function HomeContent({ onSignOut, role }: { onSignOut:()=>void, role:string }) {
 const [tab,setTab] = useState(role==='admin'?'Admin':role==='driver'?'Driver':'Passenger');
 const [from,setFrom] = useState('Phuthaditjhaba CBD');
 const [to,setTo] = useState('Tseki');
 const [ride,setRide] = useState('Share');
 const [pickupTime,setPickupTime] = useState('20:15');
 const [night,setNight] = useState(true);
 const [offers,setOffers] = useState(false);
 const [booking,setBooking] = useState<{id:string,from:string,to:string,ride:string,price:number,status:string}|null>(null);
 const [driverOffers,setDriverOffers] = useState<any[]>([]);
 const [activeDriverBookings,setActiveDriverBookings] = useState<any[]>([]);
 const [adminStats,setAdminStats] = useState({bookings:0,drivers:0,payments:0,cashSessions:0});
 const [busyAction,setBusyAction] = useState(false);
 const [cashSession,setCashSession] = useState<any>(null);
 const [cashQueue,setCashQueue] = useState<any[]>([]);
 const [cashAmount,setCashAmount] = useState('');
 const isNight = useMemo(()=> {
   const [h,m] = pickupTime.split(':').map(Number);
   return Number.isFinite(h) && Number.isFinite(m) && (h > 20 || h === 20);
 },[pickupTime]);
 const surcharge = isNight ? 20 : 0;
 const fare = baseFares[ride] + surcharge;
 useEffect(()=>{
   let channel:any; let active=true;
   (async()=>{
    if(!isSupabaseConfigured) return;
    const {data:{user}}=await supabase.auth.getUser(); if(!user) return;
    if(role==='driver') {
      const {data:openSession}=await supabase.from('cash_sessions').select('id,opening_float_zar').eq('driver_id',user.id).eq('status','open').maybeSingle(); if(active)setCashSession(openSession||null);
      const load=async()=>{const {data}=await supabase.from('booking_offers').select('id,booking_id,status,expires_at,bookings(origin,destination,ride_type,total_fare_zar,pickup_at)').eq('driver_id',user.id).eq('status','offered').gt('expires_at',new Date().toISOString()).order('offered_at',{ascending:false}); if(active)setDriverOffers(data||[]);};
      const loadActive=async()=>{const {data}=await supabase.from('bookings').select('id,origin,destination,ride_type,total_fare_zar,status,payment_status').eq('driver_id',user.id).in('status',['accepted','driver_arriving','in_progress']).order('accepted_at',{ascending:false});if(active)setActiveDriverBookings(data||[]);};
      await Promise.all([load(),loadActive()]); channel=supabase.channel('driver-offers-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'booking_offers',filter:'driver_id=eq.'+user.id},load).on('postgres_changes',{event:'*',schema:'public',table:'bookings',filter:'driver_id=eq.'+user.id},loadActive).subscribe();
    }
    if(role==='admin') {
      const {data:queue}=await supabase.from('cash_sessions').select('id,driver_id,expected_cash_zar,declared_cash_zar,variance_zar,closed_at').eq('status','submitted').order('closed_at',{ascending:false}); if(active)setCashQueue(queue||[]);
      const [b,d,p,c]=await Promise.all([supabase.from('bookings').select('id',{count:'exact',head:true}),supabase.from('profiles').select('id',{count:'exact',head:true}).eq('role','driver'),supabase.from('payments').select('id',{count:'exact',head:true}),supabase.from('cash_sessions').select('id',{count:'exact',head:true}).eq('status','submitted')]);
      if(active)setAdminStats({bookings:b.count||0,drivers:d.count||0,payments:p.count||0,cashSessions:c.count||0});
    }
   })();
   return ()=>{active=false;if(channel)supabase.removeChannel(channel);};
 },[role]);
 const createBooking = async () => {
   if (!from.trim() || !to.trim() || from.trim().toLowerCase()===to.trim().toLowerCase()) {
     Alert.alert('Check your route','Choose two different pickup and destination points.'); return;
   }
   if(!isSupabaseConfigured){Alert.alert('Backend not connected','Add your Supabase URL and publishable key, then apply the SQL migrations.');return;}
   setBusyAction(true);
   try { const {data,error}=await supabase.functions.invoke('dispatch-booking',{body:{origin:from,destination:to,ride_type:ride.toLowerCase(),pickup_at:new Date(new Date().toDateString()+' '+pickupTime+':00').toISOString(),base_fare_zar:baseFares[ride],payment_method:'cash'}}); if(error)throw error; setBooking({id:data.booking_id,from,to,ride,price:fare,status:data.offers_sent?'Waiting for driver':'No approved drivers available'}); setOffers(true); const statusChannel=supabase.channel('passenger-booking-'+data.booking_id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'bookings',filter:'id=eq.'+data.booking_id},(payload:any)=>setBooking(prev=>prev?{...prev,status:String(payload.new.status).replaceAll('_',' ')}:prev)).subscribe(); Alert.alert('Ride request sent',data.offers_sent?`${data.offers_sent} driver(s) have received your request.`:'No approved drivers are available right now.'); } catch(e:any){Alert.alert('Could not request ride',e.message||String(e));} finally{setBusyAction(false);}
 };
 const tabs = role==='admin' ? ['Passenger','Driver','Admin'] : role==='driver' ? ['Driver'] : ['Passenger'];
 return <SafeAreaView style={{flex:1,backgroundColor:C.cream}}>
  <ScrollView contentContainerStyle={{paddingBottom:34}}>
   <View style={{paddingHorizontal:22,paddingTop:16}}>
    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{fontSize:12,fontWeight:'900',letterSpacing:3,color:C.red}}>QWAQWA · FREE STATE</Text><Pressable onPress={onSignOut}><Text style={{fontSize:12,fontWeight:'900',color:C.red}}>SIGN OUT</Text></Pressable></View>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
     <Text style={{fontSize:43,fontWeight:'900',letterSpacing:-2,color:C.ink}}>Mashesha<Text style={{color:C.red}}>.</Text></Text>
     <View style={{backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:30,paddingVertical:8,paddingHorizontal:17}}><Text style={{fontWeight:'900',color:C.ink}}>Dumela!</Text></View>
    </View>
   </View>
   <View style={{height:104,backgroundColor:C.green,marginTop:8,overflow:'hidden',justifyContent:'flex-end'}}>
    <View style={{height:0,borderLeftWidth:0,borderRightWidth:0,borderBottomWidth:70,borderBottomColor:C.green,borderLeftColor:'transparent',borderRightColor:'transparent'}} />
    <View style={{position:'absolute',bottom:0,left:0,right:0,height:52,backgroundColor:C.green}} />
    <Text style={{position:'absolute',bottom:12,left:20,color:'#F5EEDB',fontWeight:'800',letterSpacing:2}}>MALUTI MOUNTAIN COUNTRY</Text>
   </View>
   <View style={{paddingHorizontal:18,marginTop:18}}>
    <View style={{flexDirection:'row',backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:26,padding:18}}>
     <View style={{flex:1}}>
      <Pressable onPress={()=>Alert.alert('Location','Live GPS will be enabled after location permissions and map provider are configured.')} style={{backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:28,padding:13,alignItems:'center'}}>
       <Text style={{fontSize:16,fontWeight:'900',color:C.ink}}>◎  Use current location</Text>
      </Pressable>
      <Field label="KE TLOHA · FROM" value={from} onChange={setFrom} placeholder="Pickup point" />
      <View style={{borderBottomWidth:1,borderColor:C.ink,borderStyle:'dashed',marginTop:18}} />
      <Field label="KE YA · TO" value={to} onChange={setTo} placeholder="Destination" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:12}}>
       {routes.map(r=><Pill key={r} label={r} active={to===r} onPress={()=>setTo(r)} />)}
      </ScrollView>
     </View>
     <Pressable onPress={()=>{setFrom(to);setTo(from)}} style={{alignSelf:'flex-end',marginLeft:8,backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:24,padding:10}}><Ionicons name="swap-vertical" size={22} color={C.ink}/></Pressable>
    </View>
    <Text style={{fontSize:24,fontWeight:'900',color:C.ink,marginTop:24,marginBottom:12}}>How do you want to go?</Text>
    {(['Share','Solo','Kombi'] as const).map((r)=>{
      const meta = r==='Share'?['Shesha Share','Share with up to 3 neighbours']:r==='Solo'?['Shesha Solo','Just you, straight there']:['Shesha Kombi','Up to 14 — family, church, groceries'];
      const selected=ride===r;
      return <Pressable key={r} onPress={()=>setRide(r)} style={{backgroundColor:selected?C.red:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:28,padding:17,marginBottom:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',elevation:2}}>
       <View style={{flex:1,paddingRight:8}}><Text style={{fontSize:21,fontWeight:'900',color:selected?'#FFF7E9':C.ink}}>{meta[0]}</Text><Text style={{fontSize:14,color:selected?'#F9E4D5':C.muted,marginTop:4}}>{meta[1]}</Text></View>
       <Text style={{fontSize:27,fontWeight:'900',color:selected?'#FFF7E9':C.ink}}>{money(baseFares[r])}</Text>
      </Pressable>;
    })}
    <View style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:22,padding:16,marginTop:4}}>
     <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
      <View style={{flex:1}}><Text style={{fontSize:19,fontWeight:'900',color:C.ink}}>☾  After 8PM Night Ride</Text><Text style={{color:C.muted,marginTop:4}}>Flat night surcharge: +R20</Text></View>
      <View style={{backgroundColor:isNight?C.green:'#D9D0C2',borderRadius:20,paddingHorizontal:12,paddingVertical:7}}><Text style={{color:isNight?'white':C.ink,fontWeight:'900'}}>{isNight?'ON':'OFF'}</Text></View>
     </View>
     <Text style={{color:C.muted,fontSize:12,marginTop:10}}>Pickup time (24-hour format)</Text>
     <TextInput value={pickupTime} onChangeText={setPickupTime} keyboardType="numbers-and-punctuation" placeholder="HH:MM" style={{fontSize:20,fontWeight:'900',color:C.ink,paddingVertical:8}} />
     <Text style={{color:C.muted,fontSize:12}}>Surcharge applies automatically for pickup times from 20:00 onwards.</Text>
    </View>
    <View style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:22,padding:16,marginTop:14}}>
     <Text style={{fontSize:12,fontWeight:'900',letterSpacing:1.5,color:C.muted}}>FARE SUMMARY</Text><View style={{backgroundColor:'#E4EBDD',borderRadius:12,padding:10,marginTop:10}}><Text style={{fontWeight:'900',color:C.green}}>PAYMENT METHOD · CASH</Text><Text style={{fontSize:12,color:C.ink,marginTop:3}}>Pay the driver directly in cash after your trip. No card or online payment is required.</Text></View>
     <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:10}}><Text style={{color:C.ink}}>Base fare · Shesha {ride}</Text><Text style={{fontWeight:'800',color:C.ink}}>{money(baseFares[ride])}</Text></View>
     <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:8}}><Text style={{color:C.ink}}>Night surcharge</Text><Text style={{fontWeight:'800',color:C.ink}}>{surcharge?'+R20':'R0'}</Text></View>
     <View style={{height:1,backgroundColor:'#D7CABB',marginVertical:12}}/>
     <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{fontSize:18,fontWeight:'900',color:C.ink}}>TOTAL</Text><Text style={{fontSize:30,fontWeight:'900',color:C.red}}>{money(fare)}</Text></View>
    </View>
    <Pressable onPress={createBooking} style={{backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:30,padding:17,alignItems:'center',marginTop:18,elevation:3}}>
     <Text style={{fontSize:18,fontWeight:'900',color:C.ink}}>{busyAction?'Sending request…':`Request my Mashesha · ${money(fare)}  →`}</Text>
    </Pressable>
    {booking && <View style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.green,borderRadius:20,padding:16,marginTop:14}}>
      <Text style={{fontWeight:'900',color:C.green}}>LIVE BOOKING · {booking.id.slice(0,8).toUpperCase()}</Text><Text style={{color:C.ink,marginTop:5}}>{booking.from} → {booking.to}</Text><Text style={{fontWeight:'900',color:C.ink,marginTop:4}}>{money(booking.price)} · {booking.status}</Text>
    </View>}
    <Text style={{fontSize:12,color:C.muted,textAlign:'center',marginTop:18}}>MASHESHA · RE A TSAMAYA!</Text>
   </View>
   <View style={{flexDirection:'row',justifyContent:'space-around',padding:14,marginTop:18,borderTopWidth:1,borderColor:'#D7CABB'}}>
    {tabs.map(t=><Pressable key={t} onPress={()=>setTab(t)} style={{padding:10,borderRadius:18,backgroundColor:tab===t?C.orange:'transparent'}}><Text style={{fontWeight:'900',color:C.ink}}>{t}</Text></Pressable>)}
   </View>
   {tab!=='Passenger' && <View style={{marginHorizontal:18,backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:22,padding:18}}>
    <Text style={{fontSize:22,fontWeight:'900',color:C.ink}}>{tab} workspace</Text>
    {tab==='Driver'?<>
      <Text style={{color:C.muted,marginTop:8}}>Incoming ride requests update automatically. Accepting is atomic: only one driver can win each booking. Mashesha currently accepts cash payments only.</Text>
      <View style={{marginTop:16,borderTopWidth:1,borderColor:'#D7CABB',paddingTop:12}}><Text style={{fontWeight:'900',color:C.ink}}>Cash shift reconciliation</Text>{cashSession?<><TextInput value={cashAmount} onChangeText={setCashAmount} keyboardType='number-pad' placeholder='Counted cash in rand' style={{borderBottomWidth:1,borderColor:C.line,padding:10,color:C.ink,marginTop:6}}/><Pressable onPress={async()=>{const declared=Number(cashAmount);if(!cashAmount||!Number.isFinite(declared)||declared<0){Alert.alert('Enter counted cash','Enter a valid amount in rand.');return;}const {data,error}=await supabase.rpc('close_cash_session',{p_session_id:cashSession.id,p_declared_cash:Math.round(declared),p_notes:null});if(error)Alert.alert('Could not close shift',error.message);else{Alert.alert('Shift submitted',`Expected cash: R${data}`);setCashSession(null);setCashAmount('');}}} style={{backgroundColor:C.orange,padding:12,borderRadius:12,marginTop:8}}><Text style={{fontWeight:'900',textAlign:'center',color:C.ink}}>SUBMIT CASH COUNT</Text></Pressable></>:<Pressable onPress={async()=>{const {data,error}=await supabase.rpc('open_cash_session',{p_opening_float:0});if(error)Alert.alert('Could not open shift',error.message);else{setCashSession({id:data,opening_float_zar:0});Alert.alert('Cash shift opened','Cash collection will be tracked for completed cash rides.');}}} style={{backgroundColor:C.green,padding:12,borderRadius:12,marginTop:8}}><Text style={{fontWeight:'900',textAlign:'center',color:'white'}}>OPEN CASH SHIFT</Text></Pressable>}</View>
      {activeDriverBookings.map(b=><View key={'active-'+b.id} style={{borderWidth:1,borderColor:C.green,borderRadius:16,padding:12,marginTop:12}}><Text style={{fontWeight:'900',color:C.ink}}>{b.origin} → {b.destination}</Text><Text style={{color:C.muted,marginTop:4}}>{b.ride_type?.toUpperCase()} · {money(b.total_fare_zar)} · {b.status?.replaceAll('_',' ')}</Text><Text style={{color:C.green,fontWeight:'900',marginTop:5}}>Cash to collect: {b.payment_status==='paid'?'PAID':money(b.total_fare_zar)}</Text>{b.payment_status!=='paid'&&<Pressable disabled={!cashSession||busyAction} onPress={async()=>{Alert.alert('Confirm cash received?',`Only continue after the passenger has handed you ${money(b.total_fare_zar)} in cash.`,[{text:'Not yet',style:'cancel'},{text:'Yes, cash received',onPress:async()=>{setBusyAction(true);const {error}=await supabase.rpc('collect_cash_fare',{p_booking_id:b.id});setBusyAction(false);if(error)Alert.alert('Could not record cash',error.message);else{setActiveDriverBookings(prev=>prev.filter(x=>x.id!==b.id));Alert.alert('Cash recorded','Fare recorded and ride completed.');}}}]);}} style={{backgroundColor:C.orange,padding:12,borderRadius:12,marginTop:10,opacity:cashSession?1:.5}}><Text style={{fontWeight:'900',textAlign:'center',color:C.ink}}>CONFIRM CASH RECEIVED</Text></Pressable>}</View>)}
      {driverOffers.length===0?<Text style={{color:C.muted,marginTop:14}}>No ride requests right now.</Text>:driverOffers.map(o=><View key={o.id} style={{borderWidth:1,borderColor:C.line,borderRadius:16,padding:12,marginTop:12}}><Text style={{fontWeight:'900',color:C.ink}}>{o.bookings?.origin} → {o.bookings?.destination}</Text><Text style={{color:C.muted,marginTop:4}}>{o.bookings?.ride_type?.toUpperCase()} · {money(o.bookings?.total_fare_zar||0)}</Text><Pressable disabled={busyAction} onPress={async()=>{setBusyAction(true);const {data,error}=await supabase.functions.invoke('accept-booking',{body:{offer_id:o.id}});setBusyAction(false);if(error)Alert.alert('Could not accept',error.message);else if(data?.accepted){Alert.alert('Booking accepted','You are assigned to this passenger.');setDriverOffers(prev=>prev.filter(x=>x.id!==o.id));}else Alert.alert('Already taken','Another driver accepted this ride.');}} style={{backgroundColor:C.green,padding:12,borderRadius:12,marginTop:10}}><Text style={{color:'white',fontWeight:'900',textAlign:'center'}}>ACCEPT RIDE</Text></Pressable></View>)}
    </>:<>
      <Text style={{color:C.muted,marginTop:8}}>Operations overview · live Supabase counts (admin account required).</Text>
      <View style={{marginTop:14,flexDirection:'row',flexWrap:'wrap',gap:10}}>{[['Bookings',adminStats.bookings],['Drivers',adminStats.drivers],['Payments',adminStats.payments],['Cash reviews',adminStats.cashSessions]].map(([label,value])=><View key={String(label)} style={{width:'47%',backgroundColor:C.cream,borderRadius:14,padding:12}}><Text style={{fontSize:12,color:C.muted,fontWeight:'800'}}>{label}</Text><Text style={{fontSize:28,color:C.ink,fontWeight:'900'}}>{value}</Text></View>)}</View>
      <Text style={{fontWeight:'900',color:C.ink,marginTop:18}}>Cash reconciliation queue</Text>{cashQueue.length===0?<Text style={{color:C.muted,marginTop:6}}>No shifts awaiting review.</Text>:cashQueue.map(q=><View key={q.id} style={{borderTopWidth:1,borderColor:'#D7CABB',paddingVertical:10}}><Text style={{fontWeight:'800',color:C.ink}}>Declared R{q.declared_cash_zar} · Expected R{q.expected_cash_zar} · Variance R{q.variance_zar}</Text><View style={{flexDirection:'row',gap:8,marginTop:8}}><Pressable onPress={async()=>{const {error}=await supabase.rpc('review_cash_session',{p_session_id:q.id,p_approve:true,p_notes:'Reviewed in admin dashboard'});if(error)Alert.alert('Review failed',error.message);else setCashQueue(prev=>prev.filter(x=>x.id!==q.id));}} style={{backgroundColor:C.green,padding:10,borderRadius:10,flex:1}}><Text style={{color:'white',fontWeight:'900',textAlign:'center'}}>APPROVE</Text></Pressable><Pressable onPress={async()=>{const {error}=await supabase.rpc('review_cash_session',{p_session_id:q.id,p_approve:false,p_notes:'Flagged for investigation'});if(error)Alert.alert('Review failed',error.message);else setCashQueue(prev=>prev.filter(x=>x.id!==q.id));}} style={{backgroundColor:C.red,padding:10,borderRadius:10,flex:1}}><Text style={{color:'white',fontWeight:'900',textAlign:'center'}}>FLAG</Text></Pressable></View></View>)}
      <Text style={{color:C.ink,fontWeight:'800',marginTop:14}}>Routes configured: {routes.length}</Text><Text style={{color:C.ink,fontWeight:'800',marginTop:8}}>Night fare rule: +R20 from 20:00</Text><Text style={{color:C.muted,fontSize:12,marginTop:10}}>Driver approval, cash review, fare edits and user administration must be completed through secured admin actions; direct client table writes are disabled.</Text>
    </>}
   </View>}
  </ScrollView>
 </SafeAreaView>;
}


function AccountGate() {
 const [session,setSession] = useState<Session|null>(null);
 const [profile,setProfile] = useState<any>(null);
 const [loading,setLoading] = useState(true);
 const [phone,setPhone] = useState('');
 const [name,setName] = useState('');
 const [otp,setOtp] = useState('');
 const [role,setRole] = useState<'passenger'|'driver'>('passenger');
 const [step,setStep] = useState<'register'|'verify'>('register');
 const [busy,setBusy] = useState(false);

 useEffect(()=>{
   let mounted=true;
   supabase.auth.getSession().then(async ({data})=>{
     if(!mounted) return;
     setSession(data.session);
     if(data.session) await loadProfile(data.session);
     if(mounted) setLoading(false);
   });
   const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next)=>{
     setSession(next);
     if(!next) setProfile(null);
     else setTimeout(()=>loadProfile(next),0);
   });
   return ()=>{mounted=false;subscription.unsubscribe();};
 },[]);

 const loadProfile = async (s:Session) => {
   const {data,error} = await supabase.from('profiles').select('*').eq('id',s.user.id).maybeSingle();
   if(error) { console.warn('Profile lookup:',error.message); return; }
   setProfile(data);
 };
 const requestCode = async () => {
   if(!isSupabaseConfigured) { Alert.alert('Connect Mashesha first','Add your Supabase project URL and publishable/anon key to the .env file, then restart Expo.'); return; }
   if(!phone.trim() || !name.trim()) { Alert.alert('Details needed','Enter your full name and phone number with country code, for example +277...'); return; }
   setBusy(true);
   const {error} = await supabase.auth.signInWithOtp({phone:phone.trim(), options:{ shouldCreateUser:true, data:{full_name:name.trim(), requested_role:role} }});
   setBusy(false);
   if(error) Alert.alert('Could not send code',error.message);
   else {setStep('verify');Alert.alert('Verification code sent','Enter the SMS code sent to your phone.');}
 };
 const verifyCode = async () => {
   setBusy(true);
   const {data,error} = await supabase.auth.verifyOtp({phone:phone.trim(),token:otp.trim(),type:'sms'});
   if(error) {setBusy(false);Alert.alert('Verification failed',error.message);return;}
   if(data.user) {
     const {data:existingProfile,error:lookupError} = await supabase.from('profiles').select('id').eq('id',data.user.id).maybeSingle();
     if(lookupError) Alert.alert('Account created, profile lookup failed',lookupError.message);
     else if(!existingProfile) {
       const {error:profileError} = await supabase.from('profiles').insert({
         id:data.user.id, full_name:name.trim() || String(data.user.user_metadata?.full_name || 'Mashesha user'),
         phone:phone.trim(), role:role
       });
       if(profileError) Alert.alert('Account created, profile needs setup',profileError.message);
       else await loadProfile(data.session!);
     } else await loadProfile(data.session!);
   }
   setBusy(false);
 };
 const signOut = async () => { await supabase.auth.signOut(); setProfile(null); setSession(null); setStep('register'); setOtp(''); };
 if(loading) return <SafeAreaView style={{flex:1,backgroundColor:C.cream,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:22,fontWeight:'900',color:C.ink}}>Mashesha.</Text><Text style={{color:C.muted,marginTop:8}}>Loading your account…</Text></SafeAreaView>;
 if(session && profile) return <HomeContent role={profile.role} onSignOut={signOut}/>;
 if(session && !profile) return <SafeAreaView style={{flex:1,backgroundColor:C.cream,justifyContent:'center',padding:24}}><Text style={{fontSize:32,fontWeight:'900',color:C.ink}}>Mashesha.</Text><Text style={{color:C.muted,marginTop:12}}>Your login is verified, but your profile could not be loaded. Check the profiles table and its row-level security policies.</Text><Pressable onPress={()=>loadProfile(session)} style={{backgroundColor:C.orange,padding:16,borderRadius:20,marginTop:20}}><Text style={{textAlign:'center',fontWeight:'900',color:C.ink}}>Retry profile</Text></Pressable><Pressable onPress={signOut} style={{padding:16}}><Text style={{textAlign:'center',fontWeight:'800',color:C.red}}>Sign out</Text></Pressable></SafeAreaView>;
 return <SafeAreaView style={{flex:1,backgroundColor:C.cream}}>
  <ScrollView contentContainerStyle={{padding:24,flexGrow:1,justifyContent:'center'}}>
   <Text style={{fontSize:12,fontWeight:'900',letterSpacing:3,color:C.red}}>QWAQWA · FREE STATE</Text>
   <Text style={{fontSize:48,fontWeight:'900',letterSpacing:-2,color:C.ink,marginTop:4}}>Mashesha<Text style={{color:C.red}}>.</Text></Text>
   <Text style={{fontSize:17,color:C.muted,fontWeight:'700',marginTop:4}}>Re a tsamaya. Let's move.</Text>
   <View style={{height:5,backgroundColor:C.green,borderRadius:5,marginVertical:25}}/>
   <Text style={{fontSize:26,fontWeight:'900',color:C.ink}}>{step==='register'?'Create your account':'Verify your number'}</Text>
   <Text style={{color:C.muted,marginTop:8,marginBottom:18}}>{step==='register'?'Use one phone number for your Mashesha passenger or driver account.':'Enter the one-time code sent by SMS.'}</Text>
   {!isSupabaseConfigured && <View style={{backgroundColor:'#FBE3D9',borderWidth:1,borderColor:C.red,borderRadius:16,padding:12,marginBottom:16}}><Text style={{fontWeight:'800',color:C.red}}>Backend setup required</Text><Text style={{color:C.ink,fontSize:13,marginTop:4}}>Add Supabase URL and publishable key in .env before account registration can work.</Text></View>}
   {step==='register' ? <>
    <Text style={{fontSize:12,fontWeight:'900',color:C.muted,letterSpacing:1}}>I WANT TO REGISTER AS</Text>
    <View style={{flexDirection:'row',marginTop:10,marginBottom:16}}>
     <Pill label="Passenger" active={role==='passenger'} onPress={()=>setRole('passenger')}/>
     <Pill label="Driver" active={role==='driver'} onPress={()=>setRole('driver')}/>
    </View>
    <Text style={{fontSize:12,fontWeight:'900',color:C.muted,letterSpacing:1}}>FULL NAME</Text>
    <TextInput value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor="#A99A8C" style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:16,padding:15,fontSize:17,color:C.ink,marginTop:7,marginBottom:16}}/>
    <Text style={{fontSize:12,fontWeight:'900',color:C.muted,letterSpacing:1}}>PHONE NUMBER</Text>
    <TextInput value={phone} onChangeText={setPhone} placeholder="+27..." keyboardType="phone-pad" placeholderTextColor="#A99A8C" style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:16,padding:15,fontSize:17,color:C.ink,marginTop:7}}/>
    <Pressable disabled={busy} onPress={requestCode} style={{backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:25,padding:17,alignItems:'center',marginTop:22}}><Text style={{fontSize:17,fontWeight:'900',color:C.ink}}>{busy?'Sending…':'Send verification code →'}</Text></Pressable>
   </> : <>
    <TextInput value={otp} onChangeText={setOtp} placeholder="6-digit SMS code" keyboardType="number-pad" maxLength={8} placeholderTextColor="#A99A8C" style={{backgroundColor:C.paper,borderWidth:2,borderColor:C.ink,borderRadius:16,padding:17,fontSize:23,letterSpacing:5,color:C.ink,textAlign:'center'}}/>
    <Pressable disabled={busy} onPress={verifyCode} style={{backgroundColor:C.orange,borderWidth:2,borderColor:C.ink,borderRadius:25,padding:17,alignItems:'center',marginTop:18}}><Text style={{fontSize:17,fontWeight:'900',color:C.ink}}>{busy?'Verifying…':'Verify and create account'}</Text></Pressable>
    <Pressable onPress={()=>setStep('register')} style={{padding:16,alignItems:'center'}}><Text style={{fontWeight:'800',color:C.red}}>Change phone number</Text></Pressable>
   </>}
   <Text style={{fontSize:12,color:C.muted,textAlign:'center',marginTop:28}}>Driver accounts require identity and vehicle approval before accepting trips.</Text>
  </ScrollView>
 </SafeAreaView>;
}
export default function App() { return <AccountGate />; }
