import { useState, useEffect, useCallback, useRef } from "react";
import api, { logout as apiLogout, wsManager } from "./src/api.js";

// ── Auth users (local fallback only) ─────────────────────────────────────────
const USERS = [
  { username:"counsellor1", password:"Care@2026",    name:"Dr. Sibanda, N.", role:"counsellor", roleLabel:"Mental Health Counsellor" },
  { username:"welfare1",    password:"Welfare@2026", name:"Ms. Choto, R.",   role:"welfare",    roleLabel:"Student Welfare Officer"  },
  { username:"admin",       password:"Admin@2026",   name:"Mr. Dube, T.",    role:"admin",      roleLabel:"System Administrator"     },
];

const ROLES = [
  { id:"counsellor", label:"Mental Health Counsellor", icon:"🧠",
    desc:"Access full student risk profiles, SHAP explanations and clinical recommendations." },
  { id:"welfare",    label:"Student Welfare Officer",   icon:"🛡️",
    desc:"View risk summaries, manage welfare referrals and monitor intervention progress." },
  { id:"admin",      label:"System Administrator",      icon:"⚙️",
    desc:"Manage user accounts, audit logs, model settings and system configuration." },
];

const TIER = {
  high:   { label:"High Risk",   bg:"#FF3B30", light:"rgba(255,59,48,0.12)",  ring:"#FF3B30" },
  medium: { label:"Medium Risk", bg:"#FF9F0A", light:"rgba(255,159,10,0.12)", ring:"#FF9F0A" },
  low:    { label:"Low Risk",    bg:"#30D158", light:"rgba(48,209,88,0.12)",  ring:"#30D158" },
};

const FALLBACK_AUDIT = [
  { time:"06:12", user:"counsellor1", action:"Viewed risk profile", target:"N00849023", level:"high"   },
  { time:"06:08", user:"welfare1",    action:"Logged intervention",  target:"N00411234", level:"high"   },
  { time:"05:55", user:"counsellor1", action:"Exported report",      target:"N00523891", level:"medium" },
  { time:"05:40", user:"admin",       action:"User account created",  target:"welfare2",  level:"info"   },
];

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#0A0A12;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  @keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  @keyframes bgPulse{0%,100%{opacity:0.5}50%{opacity:0.8}}
  @keyframes spin{to{transform:rotate(360deg)}}
  input:-webkit-autofill{-webkit-box-shadow:0 0 0 100px #13131E inset!important;-webkit-text-fill-color:#fff!important;}
`;

// ── Reusable Components ────────────────────────────────────────────────────────
function RiskGauge({ value }) {
  const r = 44, circ = 2 * Math.PI * r;
  const color = value >= 0.7 ? "#FF3B30" : value >= 0.4 ? "#FF9F0A" : "#30D158";
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10"/>
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={circ} strokeDashoffset={(1-value)*circ}
        strokeLinecap="round" transform="rotate(-90 60 60)"
        style={{filter:`drop-shadow(0 0 8px ${color})`,transition:"stroke-dashoffset 0.6s"}}/>
      <text x="60" y="54" textAnchor="middle" fill="white" fontSize="22" fontWeight="700"
        fontFamily="'Barlow Condensed',sans-serif">{Math.round(value*100)}%</text>
      <text x="60" y="72" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="10"
        fontFamily="'DM Sans',sans-serif">risk score</text>
    </svg>
  );
}

function ShapBar({ feature, value, dir, maxVal }) {
  const pct   = Math.abs(value) / maxVal * 100;
  const color = dir > 0 ? "#FF3B30" : "#30D158";
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:12,color:"rgba(255,255,255,0.75)",maxWidth:"75%"}}>{feature}</span>
        <span style={{fontSize:12,fontWeight:700,color,fontFamily:"'Barlow Condensed',sans-serif"}}>
          {dir>0?"+":""}{value.toFixed(3)}
        </span>
      </div>
      <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3,boxShadow:`0 0 6px ${color}`,transition:"width 0.5s"}}/>
      </div>
    </div>
  );
}

function StudentCard({ student, selected, onClick }) {
  const cfg = TIER[student.tier] || TIER.low;
  return (
    <div onClick={onClick} style={{
      padding:"13px 16px",marginBottom:7,borderRadius:12,cursor:"pointer",
      background:selected?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.03)",
      border:`1px solid ${selected?cfg.ring:"rgba(255,255,255,0.07)"}`,
      transition:"all 0.18s",boxShadow:selected?`0 0 0 2px ${cfg.ring}33`:"none",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:11}}>
        <div style={{width:9,height:9,borderRadius:"50%",background:cfg.bg,flexShrink:0,
          boxShadow:selected?`0 0 7px ${cfg.bg}`:"none"}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:13,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {student.name}
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>
            {student.id} · Yr {student.year}
          </div>
        </div>
        <div style={{fontSize:15,fontWeight:800,fontFamily:"'Barlow Condensed',sans-serif",color:cfg.bg,minWidth:40,textAlign:"right"}}>
          {Math.round((student.risk||0)*100)}%
        </div>
      </div>
    </div>
  );
}

function AppHeader({ user, onLogout, alertCount }) {
  const roleColour = user.role==="counsellor"?"#636AFF":user.role==="welfare"?"#30D158":"#FF9F0A";
  return (
    <header style={{background:"rgba(10,10,18,0.95)",borderBottom:"1px solid rgba(255,255,255,0.06)",
      padding:"0 28px",height:60,display:"flex",alignItems:"center",justifyContent:"space-between",
      position:"sticky",top:0,zIndex:100,backdropFilter:"blur(20px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:32,height:32,background:"linear-gradient(135deg,#FF3B30,#FF9F0A)",borderRadius:8,
          display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 12px rgba(255,59,48,0.3)"}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
          </svg>
        </div>
        <div>
          <div style={{fontSize:15,fontWeight:800,color:"#fff",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5}}>
            XAI RISK SENTINEL
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:1.5,textTransform:"uppercase"}}>
            NUST · Student Mental Health
          </div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{padding:"5px 14px",borderRadius:20,background:`${roleColour}22`,border:`1px solid ${roleColour}44`,
          fontSize:11,color:roleColour,fontWeight:600}}>
          {user.role==="counsellor"?"🧠":user.role==="welfare"?"🛡️":"⚙️"} {user.roleLabel}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{user.name}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>Logged in</div>
        </div>
        {alertCount > 0 && (
          <div style={{padding:"5px 14px",borderRadius:20,background:"rgba(255,59,48,0.12)",
            border:"1px solid rgba(255,59,48,0.3)",display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:"#FF3B30",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:12,color:"#FF3B30",fontWeight:600}}>{alertCount} Critical</span>
          </div>
        )}
        <button onClick={onLogout} style={{padding:"7px 16px",borderRadius:20,
          border:"1px solid rgba(255,255,255,0.15)",background:"transparent",
          color:"rgba(255,255,255,0.6)",fontSize:12,cursor:"pointer"}}>
          Sign Out
        </button>
      </div>
    </header>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [step, setStep]         = useState("role");
  const [selectedRole, setRole] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [hovered, setHovered]   = useState(null);

  function nextStep() {
    if (!selectedRole) { setError("Please select your role to continue."); return; }
    setError(""); setStep("credentials");
  }

  async function handleLogin() {
    if (!username.trim() || !password) { setError("Please enter your username and password."); return; }
    setLoading(true); setError("");
    try {
      const result = await api.login(username.trim(), password, selectedRole);
      if (result.success) {
        onLogin({ username: result.username || username.trim(), name: result.name || username.trim(),
                  role: result.role || selectedRole, roleLabel: result.roleLabel || selectedRole });
        return;
      }
    } catch (_) {}
    // Local fallback
    const match = USERS.find(u => u.username===username.trim() && u.password===password && u.role===selectedRole);
    if (match) { onLogin(match); }
    else { setError("Incorrect username or password for the selected role."); }
    setLoading(false);
  }

  const roleInfo = ROLES.find(r => r.id===selectedRole);

  return (
    <div style={{minHeight:"100vh",background:"#08080F",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24,position:"relative",overflow:"hidden"}}>
      <style>{GLOBAL_CSS}</style>
      {[{top:"12%",left:"18%",size:380,color:"rgba(255,59,48,0.07)"},
        {top:"65%",left:"72%",size:460,color:"rgba(255,159,10,0.06)"},
        {top:"42%",left:"48%",size:280,color:"rgba(48,209,88,0.04)"}].map((o,i)=>(
        <div key={i} style={{position:"absolute",width:o.size,height:o.size,borderRadius:"50%",
          background:o.color,top:o.top,left:o.left,transform:"translate(-50%,-50%)",
          filter:"blur(80px)",animation:`bgPulse ${3+i}s ease-in-out infinite`,pointerEvents:"none"}}/>
      ))}

      <div style={{width:"100%",maxWidth:step==="role"?620:440,background:"rgba(18,18,28,0.92)",
        borderRadius:24,border:"1px solid rgba(255,255,255,0.08)",
        boxShadow:"0 40px 80px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04)",
        backdropFilter:"blur(24px)",overflow:"hidden",animation:"fadeUp 0.45s ease",
        transition:"max-width 0.4s ease"}}>

        <div style={{background:"linear-gradient(135deg,rgba(255,59,48,0.14),rgba(255,159,10,0.08))",
          borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"26px 34px",
          display:"flex",alignItems:"center",gap:16}}>
          <div style={{width:44,height:44,borderRadius:12,
            background:"linear-gradient(135deg,#FF3B30,#FF9F0A)",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
            boxShadow:"0 4px 16px rgba(255,59,48,0.35)"}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
            </svg>
          </div>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#fff",
              fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1}}>XAI RISK SENTINEL</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",letterSpacing:2,textTransform:"uppercase"}}>
              NUST · Student Mental Health System
            </div>
          </div>
        </div>

        <div style={{padding:"30px 34px"}}>
          {/* Step indicator */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:26}}>
            {["Select Role","Sign In"].map((label,i)=>{
              const active = i===(step==="role"?0:1), done = i===0 && step==="credentials";
              return (
                <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:24,height:24,borderRadius:"50%",flexShrink:0,
                      background:done?"#30D158":active?"#FF9F0A":"rgba(255,255,255,0.08)",
                      border:`1px solid ${done?"#30D158":active?"#FF9F0A":"rgba(255,255,255,0.12)"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:11,fontWeight:700,color:"#fff"}}>
                      {done?"✓":i+1}
                    </div>
                    <span style={{fontSize:12,color:active?"#fff":"rgba(255,255,255,0.35)",
                      fontWeight:active?600:400}}>{label}</span>
                  </div>
                  {i<1&&<div style={{width:36,height:1,background:"rgba(255,255,255,0.1)"}}/>}
                </div>
              );
            })}
          </div>

          {step==="role" && (
            <div>
              <p style={{fontSize:15,fontWeight:600,color:"#fff",marginBottom:6}}>I am logging in as a…</p>
              <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:20}}>
                Select your role to see the appropriate view.
              </p>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:22}}>
                {ROLES.map(role=>{
                  const active = selectedRole===role.id, isHov = hovered===role.id;
                  return (
                    <div key={role.id} onClick={()=>{setRole(role.id);setError("");}}
                      onMouseEnter={()=>setHovered(role.id)} onMouseLeave={()=>setHovered(null)}
                      style={{padding:"15px 18px",borderRadius:14,cursor:"pointer",
                        display:"flex",alignItems:"center",gap:16,
                        background:active?"rgba(255,159,10,0.08)":isHov?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.03)",
                        border:`1px solid ${active?"rgba(255,159,10,0.4)":"rgba(255,255,255,0.08)"}`,
                        transition:"all 0.18s"}}>
                      <div style={{width:40,height:40,borderRadius:10,flexShrink:0,
                        background:active?"rgba(255,159,10,0.15)":"rgba(255,255,255,0.06)",
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                        {role.icon}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:3}}>{role.label}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",lineHeight:1.4}}>{role.desc}</div>
                      </div>
                      <div style={{width:18,height:18,borderRadius:"50%",flexShrink:0,
                        border:`2px solid ${active?"#FF9F0A":"rgba(255,255,255,0.2)"}`,
                        background:active?"#FF9F0A":"transparent",
                        display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {active&&<div style={{width:6,height:6,borderRadius:"50%",background:"#fff"}}/>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {error&&<p style={{color:"#FF3B30",fontSize:12,marginBottom:14}}>{error}</p>}
              <button onClick={nextStep} style={{width:"100%",padding:"13px 0",borderRadius:12,
                border:"none",background:"linear-gradient(135deg,#FF3B30,#FF9F0A)",
                color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",
                fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5}}>
                CONTINUE →
              </button>
            </div>
          )}

          {step==="credentials" && (
            <div>
              {roleInfo&&(
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
                  borderRadius:12,background:"rgba(255,159,10,0.08)",
                  border:"1px solid rgba(255,159,10,0.2)",marginBottom:22}}>
                  <span style={{fontSize:18}}>{roleInfo.icon}</span>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.8)",fontWeight:500}}>{roleInfo.label}</span>
                  <button onClick={()=>{setStep("role");setError("");}}
                    style={{marginLeft:"auto",fontSize:11,color:"rgba(255,159,10,0.8)",
                      background:"none",border:"none",cursor:"pointer"}}>Change</button>
                </div>
              )}
              {[
                {label:"Username",val:username,set:setUsername,type:"text",ph:"Enter username"},
                {label:"Password",val:password,set:setPassword,type:showPwd?"text":"password",ph:"Enter password"},
              ].map(f=>(
                <div key={f.label} style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:6,
                    textTransform:"uppercase",letterSpacing:1}}>{f.label}</div>
                  <div style={{position:"relative"}}>
                    <input type={f.type} value={f.val}
                      onChange={e=>f.set(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                      placeholder={f.ph}
                      style={{width:"100%",padding:"11px 14px",
                        background:"rgba(255,255,255,0.05)",
                        border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,
                        color:"#fff",fontSize:14,outline:"none",fontFamily:"'DM Sans',sans-serif"}}/>
                    {f.label==="Password"&&(
                      <button onClick={()=>setShowPwd(p=>!p)}
                        style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
                          background:"none",border:"none",color:"rgba(255,255,255,0.4)",
                          cursor:"pointer",fontSize:11}}>
                        {showPwd?"HIDE":"SHOW"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {error&&(
                <div style={{color:"#FF3B30",fontSize:12,marginBottom:14,padding:"9px 12px",
                  background:"rgba(255,59,48,0.08)",borderRadius:8,
                  border:"1px solid rgba(255,59,48,0.2)"}}>
                  {error}
                </div>
              )}
              <button onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"13px 0",
                borderRadius:12,border:"none",
                background:loading?"rgba(255,59,48,0.4)":"linear-gradient(135deg,#FF3B30,#FF9F0A)",
                color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",
                fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5,
                display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                {loading&&<div style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",
                  borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>}
                {loading?"SIGNING IN…":"SIGN IN →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
function AdminDashboard({ user, onLogout }) {
  const [systemUsers, setSystemUsers] = useState([]);
  const [auditLogs,   setAuditLogs]   = useState(FALLBACK_AUDIT);
  const [stats,       setStats]       = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser,     setNewUser]     = useState({name:"",username:"",password:"",role:"counsellor"});
  const [addErr,      setAddErr]      = useState("");
  const [addLoading,  setAddLoading]  = useState(false);

  useEffect(()=>{
    api.fetchUsers().then(r=>{ if(r.success&&r.users) setSystemUsers(r.users); });
    api.fetchAuditLogs().then(r=>{ if(r.success&&r.logs) setAuditLogs(r.logs); });
    api.fetchStats().then(r=>{ if(r.success) setStats(r); });
  },[]);

  async function handleAddUser() {
    if(!newUser.name||!newUser.username||!newUser.password){setAddErr("All fields required.");return;}
    setAddLoading(true);setAddErr("");
    const LABELS={counsellor:"Mental Health Counsellor",welfare:"Student Welfare Officer",admin:"System Administrator"};
    const r = await api.createUser({...newUser,roleLabel:LABELS[newUser.role]||newUser.role});
    if(r.success){
      setSystemUsers(p=>[...p,{...newUser,roleLabel:LABELS[newUser.role],status:"Active",last:"Just now"}]);
      setShowAddUser(false);setNewUser({name:"",username:"",password:"",role:"counsellor"});
    } else { setAddErr(r.error||"Failed to create user."); }
    setAddLoading(false);
  }

  const totalStudents = stats?.total || 0;
  const counts        = stats?.counts || {high:0,medium:0,low:0};

  return (
    <div style={{minHeight:"100vh",background:"#0A0A12",color:"#fff",display:"flex",flexDirection:"column"}}>
      <style>{GLOBAL_CSS}</style>
      <AppHeader user={user} onLogout={onLogout} alertCount={counts.high||0}/>
      <div style={{padding:"26px 30px",maxWidth:1100,margin:"0 auto",width:"100%"}}>

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:26}}>
          {[
            {label:"Students Monitored", value:totalStudents||"—",    color:"#fff"},
            {label:"High Risk Alerts",   value:counts.high||0,        color:"#FF3B30"},
            {label:"Active Users",       value:systemUsers.filter(u=>u.status==="Active").length||3, color:"#30D158"},
            {label:"Model AUC-ROC",      value:stats?.modelInfo?.auc_roc||"0.91", color:"#FF9F0A"},
          ].map(s=>(
            <div key={s.label} style={{background:"rgba(255,255,255,0.03)",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"18px 20px"}}>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",
                letterSpacing:1,marginBottom:8}}>{s.label}</div>
              <div style={{fontSize:32,fontWeight:800,color:s.color,
                fontFamily:"'Barlow Condensed',sans-serif"}}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:16}}>
          {/* User Management */}
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:16,padding:22}}>
            <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
              textTransform:"uppercase",letterSpacing:1.5,marginBottom:16}}>User Management</div>
            {systemUsers.map((u,i)=>(
              <div key={u.username||i} style={{display:"flex",alignItems:"center",gap:14,
                padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{width:36,height:36,borderRadius:10,
                  background:"rgba(255,255,255,0.07)",display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:13,fontWeight:700,
                  color:"rgba(255,255,255,0.6)",fontFamily:"'Barlow Condensed',sans-serif"}}>
                  {(u.name||"?").split(" ").map(n=>n[0]).join("").slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{u.name}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{u.username} · {u.role}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,
                    background:u.status==="Active"?"rgba(48,209,88,0.15)":"rgba(255,255,255,0.06)",
                    color:u.status==="Active"?"#30D158":"rgba(255,255,255,0.35)",
                    border:`1px solid ${u.status==="Active"?"rgba(48,209,88,0.3)":"rgba(255,255,255,0.1)"}`}}>
                    {u.status}
                  </span>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:3}}>
                    {u.last}
                  </div>
                </div>
              </div>
            ))}
            <button onClick={()=>{setShowAddUser(true);setAddErr("");}}
              style={{marginTop:14,width:"100%",padding:10,borderRadius:10,
                border:"1px dashed rgba(255,255,255,0.2)",background:"transparent",
                color:"rgba(255,255,255,0.5)",fontSize:12,cursor:"pointer"}}>
              + Add User
            </button>
          </div>

          {/* Audit Log */}
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:16,padding:22}}>
            <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
              textTransform:"uppercase",letterSpacing:1.5,marginBottom:16}}>Recent Audit Log</div>
            {auditLogs.slice(0,8).map((log,i)=>(
              <div key={i} style={{display:"flex",gap:12,padding:"10px 0",
                borderBottom:"1px solid rgba(255,255,255,0.05)",alignItems:"flex-start"}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                  fontFamily:"'Barlow Condensed',sans-serif",minWidth:36,marginTop:1}}>{log.time}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:"#fff"}}>{log.action}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{log.user} → {log.target}</div>
                </div>
                <div style={{width:8,height:8,borderRadius:"50%",marginTop:4,flexShrink:0,
                  background:log.level==="high"?"#FF3B30":log.level==="medium"?"#FF9F0A":log.level==="info"?"#636AFF":"#30D158"}}/>
              </div>
            ))}
          </div>
        </div>

        {/* Model info bar */}
        <div style={{marginTop:16,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",
          borderRadius:12,padding:"14px 20px",display:"flex",gap:32,flexWrap:"wrap"}}>
          {[["Model","XGBoost v2.1"],["Last Trained","29 Apr 2026"],["SHAP","v0.46"],
            ["Next Retrain","01 Jun 2026"],["Records",`${totalStudents} students`],["Status","✓ Healthy"]
          ].map(([k,v])=>(
            <div key={k}>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:1}}>{k}</div>
              <div style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.8)",marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add user modal */}
      {showAddUser&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setShowAddUser(false)}>
          <div style={{background:"#13131E",border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:18,padding:32,width:380,animation:"slideIn 0.2s ease"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:22,
              fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5}}>ADD SYSTEM USER</div>
            {[{label:"Full Name",key:"name",ph:"e.g. Dr. Mabunda, F."},
              {label:"Username",key:"username",ph:"e.g. counsellor3"},
              {label:"Password",key:"password",ph:"Min 8 characters",type:"password"}
            ].map(({label,key,ph,type})=>(
              <div key={key} style={{marginBottom:14}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:5,
                  textTransform:"uppercase",letterSpacing:1}}>{label}</div>
                <input type={type||"text"} value={newUser[key]}
                  onChange={e=>setNewUser(p=>({...p,[key]:e.target.value}))}
                  placeholder={ph}
                  style={{width:"100%",padding:"10px 14px",background:"rgba(255,255,255,0.05)",
                    border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,
                    color:"#fff",fontSize:13,outline:"none"}}/>
              </div>
            ))}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:5,
                textTransform:"uppercase",letterSpacing:1}}>Role</div>
              <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))}
                style={{width:"100%",padding:"10px 14px",background:"rgba(255,255,255,0.06)",
                  border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#fff",fontSize:13,outline:"none"}}>
                <option value="counsellor">Counsellor</option>
                <option value="welfare">Welfare Officer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {addErr&&<div style={{color:"#FF3B30",fontSize:12,marginBottom:14,padding:"8px 12px",
              background:"rgba(255,59,48,0.1)",borderRadius:8}}>{addErr}</div>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowAddUser(false)}
                style={{flex:1,padding:"10px 0",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)",
                  background:"transparent",color:"rgba(255,255,255,0.5)",fontSize:13,cursor:"pointer"}}>
                Cancel
              </button>
              <button onClick={handleAddUser} disabled={addLoading}
                style={{flex:2,padding:"10px 0",borderRadius:10,border:"none",
                  background:addLoading?"rgba(99,106,255,0.4)":"#636AFF",
                  color:"#fff",fontSize:13,fontWeight:600,cursor:addLoading?"not-allowed":"pointer"}}>
                {addLoading?"Creating…":"Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Clinical Dashboard ────────────────────────────────────────────────────────
function ClinicalDashboard({ user, onLogout }) {
  const [students,    setStudents]    = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [filter,      setFilter]      = useState("all");
  const [search,      setSearch]      = useState("");
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page,        setPage]        = useState(1);
  const [totalPages,  setTotalPages]  = useState(1);
  const [total,       setTotal]       = useState(0);
  const [counts,      setCounts]      = useState({high:0,medium:0,low:0});
  const [pipelineMsg, setPipelineMsg] = useState("");
  const [pipelineStatus,setPipelineStatus]=useState(null);
  const searchTimer = useRef(null);
  const listRef     = useRef(null);

  const fetchPage = useCallback(async (pg, filt, srch, replace=false) => {
    if (pg === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = { page: pg, limit: 50 };
      if (filt && filt !== "all") params.tier = filt;
      if (srch) params.search = srch;
      const r = await api.fetchStudents(params);
      if (r.success) {
        const newStudents = r.students || [];
        setStudents(prev => replace || pg === 1 ? newStudents : [...prev, ...newStudents]);
        setTotalPages(r.pages || 1);
        setTotal(r.total || 0);
        if ((replace || pg === 1) && newStudents.length > 0) {
          setSelected(newStudents[0]);
        }
        // Recount from server total stats if available
        if (r.counts) setCounts(r.counts);
      }
    } catch (e) {
      console.error("fetchPage error:", e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial load + counts + poll for ML readiness
  useEffect(() => {
    fetchPage(1, "all", "");

    // Fetch tier counts
    Promise.all([
      api.fetchStudents({page:1,limit:1,tier:"high"}),
      api.fetchStudents({page:1,limit:1,tier:"medium"}),
      api.fetchStudents({page:1,limit:1,tier:"low"}),
    ]).then(([h,m,l]) => {
      setCounts({
        high:   h.success ? h.total : 0,
        medium: m.success ? m.total : 0,
        low:    l.success ? l.total : 0,
      });
    });

    // Poll /predictions-status until ML is ready, then auto-refresh
    let pollInterval = null;
    async function pollMlStatus() {
      try {
        const r = await api.fetchStudents({page:1,limit:1});
        if (r.ml_ready) {
          clearInterval(pollInterval);
          setPipelineMsg("ML predictions ready — refreshing…");
          setPipelineStatus("done");
          fetchPage(1, "all", "", true);
          Promise.all([
            api.fetchStudents({page:1,limit:1,tier:"high"}),
            api.fetchStudents({page:1,limit:1,tier:"medium"}),
            api.fetchStudents({page:1,limit:1,tier:"low"}),
          ]).then(([h,m,l]) => {
            setCounts({high:h.total||0,medium:m.total||0,low:l.total||0});
          });
          setTimeout(()=>setPipelineStatus(null), 4000);
        } else if (r.ml_ready === false) {
          setPipelineMsg("Computing ML predictions in background…");
          setPipelineStatus("running");
        }
      } catch {}
    }
    pollInterval = setInterval(pollMlStatus, 8000);
    pollMlStatus();

    // WebSocket real-time updates
    wsManager.connect();
    wsManager.on("student_update", updated => {
      setStudents(prev => prev.map(s => s.id===updated.id ? updated : s));
      setSelected(prev => prev?.id===updated.id ? updated : prev);
    });
    wsManager.on("pipeline_completed", () => {
      clearInterval(pollInterval);
      setPipelineStatus("done"); setPipelineMsg("Pipeline complete — predictions refreshed.");
      fetchPage(1, filter, search, true);
      setTimeout(()=>setPipelineStatus(null),4000);
    });
    return () => { wsManager.disconnect(); clearInterval(pollInterval); };
  }, []);

  // Filter / search change
  useEffect(() => {
    setPage(1);
    fetchPage(1, filter, search, true);
  }, [filter, search]);

  function handleSearch(val) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 350);
  }

  function handleScroll(e) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && !loadingMore && page < totalPages) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPage(nextPage, filter, search);
    }
  }

  const cfg     = selected ? (TIER[selected.tier]||TIER.low) : TIER.low;
  const maxShap = selected?.shap ? Math.max(...selected.shap.map(s=>Math.abs(s.value||0)), 0.001) : 1;

  if (loading) {
    return (
      <div style={{minHeight:"100vh",background:"#0A0A12",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <style>{GLOBAL_CSS}</style>
        <div style={{textAlign:"center"}}>
          <div style={{width:48,height:48,border:"3px solid rgba(255,255,255,0.1)",borderTopColor:"#FF9F0A",
            borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
          <div style={{color:"rgba(255,255,255,0.5)",fontSize:14}}>Loading {total||"student"} records…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:"#0A0A12",display:"flex",flexDirection:"column",color:"#fff"}}>
      <style>{GLOBAL_CSS}</style>
      <AppHeader user={user} onLogout={()=>{apiLogout();onLogout();}} alertCount={counts.high}/>

      {/* Pipeline toast */}
      {pipelineStatus&&(
        <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,
          background:pipelineStatus==="error"?"rgba(255,59,48,0.95)":pipelineStatus==="running"?"rgba(99,106,255,0.95)":"rgba(48,209,88,0.95)",
          color:"#fff",borderRadius:12,padding:"12px 20px",display:"flex",alignItems:"center",gap:10,
          boxShadow:"0 8px 32px rgba(0,0,0,0.5)",animation:"slideIn 0.3s ease",fontSize:13,fontWeight:500}}>
          {pipelineStatus==="running"
            ?<div style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",
                borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
            :<span>{pipelineStatus==="error"?"⚠":"✓"}</span>}
          {pipelineMsg}
        </div>
      )}

      {/* Filter + search bar */}
      <div style={{background:"rgba(255,255,255,0.02)",borderBottom:"1px solid rgba(255,255,255,0.05)",
        padding:"10px 28px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        {[{key:"all",label:"All Students",count:total,color:"rgba(255,255,255,0.6)"},
          {key:"high",  label:"High Risk",  count:counts.high,  color:"#FF3B30"},
          {key:"medium",label:"Medium Risk",count:counts.medium,color:"#FF9F0A"},
          {key:"low",   label:"Low Risk",   count:counts.low,   color:"#30D158"},
        ].map(f=>(
          <button key={f.key} onClick={()=>setFilter(f.key)} style={{
            padding:"6px 16px",borderRadius:20,border:"1px solid",cursor:"pointer",
            borderColor:filter===f.key?f.color:"rgba(255,255,255,0.1)",
            background:filter===f.key?`${f.color}22`:"transparent",
            color:filter===f.key?f.color:"rgba(255,255,255,0.4)",
            fontSize:12,fontWeight:600,transition:"all 0.2s"}}>
            {f.label} <span style={{opacity:0.7}}>({f.count})</span>
          </button>
        ))}
        <input
          placeholder="Search name or ID…"
          onChange={e=>handleSearch(e.target.value)}
          style={{marginLeft:"auto",padding:"6px 14px",background:"rgba(255,255,255,0.05)",
            border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,color:"#fff",
            fontSize:12,outline:"none",width:200}}/>
        {user.role==="welfare"&&(
          <div style={{padding:"5px 14px",borderRadius:20,background:"rgba(48,209,88,0.08)",
            border:"1px solid rgba(48,209,88,0.2)",fontSize:11,color:"rgba(48,209,88,0.8)"}}>
            🛡️ Welfare view
          </div>
        )}
      </div>

      {/* Main layout */}
      <div style={{display:"flex",flex:1,overflow:"hidden",height:"calc(100vh - 108px)"}}>

        {/* Student list sidebar */}
        <div ref={listRef} onScroll={handleScroll}
          style={{width:290,flexShrink:0,borderRight:"1px solid rgba(255,255,255,0.06)",
            overflowY:"auto",padding:"14px 12px"}}>
          {students.map(s=>(
            <StudentCard key={s.id} student={s} selected={selected?.id===s.id}
              onClick={()=>setSelected(s)}/>
          ))}
          {loadingMore&&(
            <div style={{textAlign:"center",padding:16,color:"rgba(255,255,255,0.3)",fontSize:12}}>
              <div style={{width:20,height:20,border:"2px solid rgba(255,255,255,0.1)",
                borderTopColor:"#FF9F0A",borderRadius:"50%",animation:"spin 0.8s linear infinite",
                margin:"0 auto 6px"}}/>
              Loading more…
            </div>
          )}
          {!loadingMore && page >= totalPages && students.length > 0 && (
            <div style={{textAlign:"center",padding:"12px 0",fontSize:11,color:"rgba(255,255,255,0.2)"}}>
              All {total} students loaded
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected ? (
          <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}} key={selected.id}>
            <div style={{animation:"slideIn 0.3s ease"}}>

              {/* Student header */}
              <div style={{display:"flex",alignItems:"flex-start",gap:24,marginBottom:24}}>
                <div style={{width:56,height:56,borderRadius:16,
                  background:`linear-gradient(135deg,${cfg.bg}44,${cfg.bg}11)`,
                  border:`1px solid ${cfg.bg}44`,display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:20,fontWeight:800,color:cfg.bg,flexShrink:0,
                  fontFamily:"'Barlow Condensed',sans-serif"}}>
                  {selected.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <h2 style={{fontSize:22,fontWeight:700,color:"#fff",
                      fontFamily:"'Barlow Condensed',sans-serif"}}>{selected.name}</h2>
                    <span style={{padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700,
                      background:cfg.light,color:cfg.bg,border:`1px solid ${cfg.bg}44`,
                      letterSpacing:0.5,textTransform:"uppercase"}}>{cfg.label}</span>
                  </div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.45)",marginTop:4}}>
                    {selected.id} · {selected.programme} · Year {selected.year}
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",marginTop:2}}>
                    Last updated: {selected.lastUpdated}
                  </div>
                </div>
                <RiskGauge value={selected.risk||0}/>
              </div>

              {/* Stat pills */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
                {[
                  {label:"Current GPA",
                   value:selected.gpa?.length ? selected.gpa[selected.gpa.length-1].toFixed(1) : "N/A",
                   sub:selected.gpa?.length > 1 ? `Was ${selected.gpa[0].toFixed(1)}` : "",
                   warn:selected.gpa?.length && selected.gpa[selected.gpa.length-1] < 2.5},
                  {label:"Attendance",
                   value:`${selected.attendance||0}%`,
                   sub:(selected.attendance||0)<60?"Critical":(selected.attendance||0)<75?"Below threshold":"Acceptable",
                   warn:(selected.attendance||0)<75},
                  {label:"LMS Logins/wk",value:selected.lmsLogins||0,sub:"This week",warn:(selected.lmsLogins||0)<5},
                ].map(c=>(
                  <div key={c.label} style={{
                    background:c.warn?"rgba(255,59,48,0.07)":"rgba(255,255,255,0.04)",
                    border:`1px solid ${c.warn?"rgba(255,59,48,0.25)":"rgba(255,255,255,0.07)"}`,
                    borderRadius:12,padding:"16px 18px"}}>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",
                      letterSpacing:1,marginBottom:6}}>{c.label}</div>
                    <div style={{fontSize:26,fontWeight:800,color:c.warn?"#FF3B30":"#fff",
                      fontFamily:"'Barlow Condensed',sans-serif"}}>{c.value}</div>
                    <div style={{fontSize:11,color:c.warn?"rgba(255,59,48,0.7)":"rgba(255,255,255,0.35)",marginTop:2}}>
                      {c.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* SHAP + Explanation */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
                  borderRadius:14,padding:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
                    textTransform:"uppercase",letterSpacing:1.5,marginBottom:16}}>
                    {user.role==="counsellor"?"SHAP Feature Contributions":"Top Risk Factors"}
                  </div>
                  {(selected.shap||[])
                    .filter(s=>user.role==="counsellor"||s.dir>0)
                    .slice(0, user.role==="counsellor"?undefined:3)
                    .map((s,i)=>(
                    <ShapBar key={i} feature={s.feature} value={s.value||0} dir={s.dir||1} maxVal={maxShap}/>
                  ))}
                  {(!selected.shap||selected.shap.length===0)&&(
                    <p style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontStyle:"italic"}}>
                      No SHAP data available for this student.
                    </p>
                  )}
                  {user.role==="welfare"&&(
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",marginTop:10,fontStyle:"italic"}}>
                      Full SHAP values visible to Mental Health Counsellors only.
                    </div>
                  )}
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:16}}>
                  <div style={{background:`linear-gradient(135deg,${cfg.bg}0A,rgba(255,255,255,0.02))`,
                    border:`1px solid ${cfg.bg}25`,borderRadius:14,padding:20,flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:cfg.bg,textTransform:"uppercase",
                      letterSpacing:1.5,marginBottom:12}}>XAI Explanation</div>
                    {selected.explanation && selected.explanation.trim() ? (
                      <p style={{fontSize:13,color:"rgba(255,255,255,0.75)",lineHeight:1.65}}>
                        {selected.explanation}
                      </p>
                    ) : !mlReady ? (
                      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0"}}>
                        <div style={{width:13,height:13,border:"2px solid rgba(255,255,255,0.15)",
                          borderTopColor:cfg.bg,borderRadius:"50%",animation:"spin 0.9s linear infinite",flexShrink:0}}/>
                        <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontStyle:"italic"}}>
                          ML predictions computing — explanation will appear shortly.
                        </p>
                      </div>
                    ) : (
                      <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontStyle:"italic"}}>
                        No explanation generated for this student.
                      </p>
                    )}
                  </div>
                  <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
                    borderRadius:14,padding:20}}>
                    <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
                      textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>
                      {user.role==="counsellor"?"Clinical Recommendations":"Welfare Actions"}
                    </div>
                    {(selected.intervention||[]).map((action,i)=>(
                      <div key={i} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
                        <div style={{width:20,height:20,borderRadius:6,flexShrink:0,
                          background:i===0&&selected.tier==="high"?"rgba(255,59,48,0.2)":"rgba(255,255,255,0.07)",
                          border:`1px solid ${i===0&&selected.tier==="high"?"rgba(255,59,48,0.4)":"rgba(255,255,255,0.1)"}`,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:10,fontWeight:700,
                          color:i===0&&selected.tier==="high"?"#FF3B30":"rgba(255,255,255,0.4)"}}>
                          {i+1}
                        </div>
                        <span style={{fontSize:12,color:"rgba(255,255,255,0.7)",lineHeight:1.5,flex:1}}>
                          {action}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* GPA trajectory */}
              {selected.gpa&&selected.gpa.length>0&&(
                <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
                  borderRadius:14,padding:20,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
                    textTransform:"uppercase",letterSpacing:1.5,marginBottom:16}}>
                    Academic Trajectory — GPA per Semester
                  </div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:12,height:80}}>
                    {selected.gpa.map((g,i)=>{
                      const h=(g/4.0)*80;
                      const color=g<2.5?"#FF3B30":g<3.0?"#FF9F0A":"#30D158";
                      return (
                        <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,flex:1}}>
                          <span style={{fontSize:12,fontWeight:700,color,fontFamily:"'Barlow Condensed',sans-serif"}}>
                            {g.toFixed(1)}
                          </span>
                          <div style={{width:"100%",height:`${h}px`,background:color,
                            borderRadius:"6px 6px 2px 2px",opacity:0.8,boxShadow:`0 0 8px ${color}66`}}/>
                          <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Sem {i+1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <div style={{padding:"12px 16px",background:"rgba(255,255,255,0.02)",
                borderRadius:10,border:"1px solid rgba(255,255,255,0.05)"}}>
                <p style={{fontSize:11,color:"rgba(255,255,255,0.3)",lineHeight:1.6,fontStyle:"italic"}}>
                  ⚠️ Decision support only. All predictions must be reviewed by a qualified professional
                  before any intervention is initiated. XAI explanations support, not replace, clinical judgement.
                  Model: XGBoost v2.1 · SHAP v0.46 · Last trained: Apr 2026.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <p style={{color:"rgba(255,255,255,0.2)",fontSize:14}}>Select a student to view their profile.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  if (!user) return <LoginPage onLogin={setUser}/>;
  if (user.role==="admin")
    return <AdminDashboard user={user} onLogout={()=>{apiLogout();setUser(null);}}/>;
  return <ClinicalDashboard user={user} onLogout={()=>{apiLogout();setUser(null);}}/>;
}
