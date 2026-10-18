// Backend layer: Supabase client + auth helpers. Uses only the public anon key.
(function(){
  const C=window.GB_CONFIG||{};
  const ok=!!(C.SUPABASE_URL&&C.SUPABASE_ANON_KEY);
  const sb=ok?supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
  const redirect=location.origin+location.pathname;
  window.GB={sb,ok,
    signIn:(email,password)=>sb.auth.signInWithPassword({email,password}),
    signUp:(email,password,username)=>sb.auth.signUp({email,password,options:{data:{username},emailRedirectTo:redirect}}),
    sendOtp:email=>sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirect}}),
    verifyOtp:(email,token)=>sb.auth.verifyOtp({email,token,type:"email"}),
    reset:email=>sb.auth.resetPasswordForEmail(email,{redirectTo:redirect}),
    setPassword:password=>sb.auth.updateUser({password}),
    signOut:()=>sb.auth.signOut(),
    usernameFree:async u=>{const{count}=await sb.from("profiles").select("id",{count:"exact",head:true}).ilike("username",u);return !count}
  };
})();
