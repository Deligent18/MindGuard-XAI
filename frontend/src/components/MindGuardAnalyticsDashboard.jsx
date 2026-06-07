import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { fetchAnalytics } from '../api';

const FALLBACK_DATA = {
  overview: {
    totalStudents: 1200,
    studentGrowth: 48,
    highRisk: 120,
    highRiskPct: 10,
    mediumRisk: 240,
    mediumRiskPct: 20,
    avgAttendance: 71.4,
    attendanceGrowth: 2.1,
  },
  departments: [
    { name: 'BSc Computer Science', high: 18, total: 120 },
    { name: 'BSc Software Engineering', high: 16, total: 110 },
    { name: 'BSc Informatics', high: 14, total: 95 },
    { name: 'BSc Data Science', high: 12, total: 90 },
    { name: 'BSc Computer Engineering', high: 22, total: 180 },
    { name: 'BSc Information Systems', high: 10, total: 85 },
    { name: 'BSc Cybersecurity', high: 8, total: 70 },
    { name: 'BSc Bioinformatics', high: 20, total: 150 },
  ],
  recentActivity: [
    { id: 1, type: 'critical', text: 'Tariro Chimuti flagged as critical — same-day contact required', time: '06:51' },
    { id: 2, type: 'info', text: 'Dr. Sibanda viewed risk profile N24254506L', time: '06:38' },
    { id: 3, type: 'medium', text: 'welfare1 logged intervention for N23269930L', time: '06:08' },
    { id: 4, type: 'info', text: 'counsellor1 exported risk report — 12 students', time: '05:55' },
    { id: 5, type: 'success', text: 'Pipeline complete — 1200 students refreshed', time: '04:00' },
    { id: 6, type: 'critical', text: 'Alert acknowledged — N00849023 escalated to Dean', time: '03:15' },
  ],
};

const CHART_CONFIG = {
  gridColor: 'rgba(255,255,255,0.06)',
  tickColor: 'rgba(255,255,255,0.35)',
};

const StatCard = ({ label, value, subtext, color = 'inherit', subColor = 'default' }) => (
  <div style={styles.stat}>
    <div style={styles.statLabel}>{label}</div>
    <div style={{ ...styles.statVal, color: color !== 'inherit' ? color : '#fff' }}>{value}</div>
    <div style={{ ...styles.statSub, color: subColor === 'up' ? '#34D963' : subColor === 'down' ? '#FF6B6B' : 'rgba(255,255,255,0.3)' }}>{subtext}</div>
  </div>
);

const ChartCard = ({ title, children, fullWidth = false }) => (
  <div style={{ ...styles.chartCard, gridColumn: fullWidth ? '1 / -1' : undefined }}>
    <div style={styles.chartTitle}>{title}</div>
    {children}
  </div>
);

const DepartmentTable = ({ data }) => {
  const sorted = [...data].sort((a, b) => (b.high / b.total) - (a.high / a.total));
  return (
    <div>
      {sorted.map((dept) => {
        const pct = Math.round((dept.high / dept.total) * 100);
        const color = pct >= 15 ? '#FF3B30' : pct >= 10 ? '#FF9F0A' : '#30D158';
        return (
          <div key={dept.name} style={styles.deptRow}>
            <div style={styles.deptName}>{dept.name}</div>
            <div style={styles.deptBarWrap}><div style={{ ...styles.deptBar, width: `${pct * 3}%`, background: color }} /></div>
            <div style={{ ...styles.deptPct, color }}>{pct}%</div>
            <div style={styles.deptCount}>{dept.high}</div>
          </div>
        );
      })}
    </div>
  );
};

const ActivityLog = ({ activities }) => {
  const dotColorMap = { critical: '#FF3B30', info: '#636AFF', medium: '#FF9F0A', success: '#30D158' };
  return (
    <div>
      {activities.map((activity) => (
        <div key={activity.id} style={styles.activityItem}>
          <div style={{ ...styles.actDot, background: dotColorMap[activity.type] || '#636AFF' }} />
          <div style={styles.actText}>{activity.text}</div>
          <div style={styles.actTime}>{activity.time}</div>
        </div>
      ))}
    </div>
  );
};

const FacultyChart = ({ faculties }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    const labels = faculties.map((f) => f.faculty);
    const highData = faculties.map((f) => f.high);
    const mediumData = faculties.map((f) => f.medium);
    const lowData = faculties.map((f) => f.low);

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Applied Sci', 'Engineering', 'Commerce', 'Health Sci'],
        datasets: [
          { label: 'High', data: labels.length ? highData : [38, 42, 22, 18], backgroundColor: '#FF3B30', borderRadius: 3, stack: 's' },
          { label: 'Medium', data: labels.length ? mediumData : [82, 94, 38, 26], backgroundColor: '#FF9F0A', borderRadius: 0, stack: 's' },
          { label: 'Low', data: labels.length ? lowData : [230, 264, 182, 164], backgroundColor: '#30D158', borderRadius: 0, stack: 's' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}` } } },
        scales: { x: { stacked: true, ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } }, y: { stacked: true, ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } } },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [faculties]);
  return <div style={{ position: 'relative', width: '100%', height: '180px' }}><canvas ref={canvasRef} role="img" aria-label="Stacked bar chart of risk distribution across faculties" /></div>;
};

const GPAChart = () => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && !chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: 'line',
        data: { labels: ['Sem 1', 'Sem 2', 'Sem 3'], datasets: [ { label: 'Avg GPA', data: [3.1, 2.95, 2.8], borderColor: '#636AFF', backgroundColor: 'rgba(99,106,255,0.08)', tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: '#636AFF' }, { label: 'High-risk avg', data: [2.4, 1.9, 1.6], borderColor: '#FF3B30', backgroundColor: 'rgba(255,59,48,0.06)', tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: '#FF3B30', borderDash: [4, 3] } ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } }, y: { min: 1, max: 4, ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 }, stepSize: 0.5 }, grid: { color: CHART_CONFIG.gridColor } } } },
      });
    }
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, []);
  return <div style={{ position: 'relative', width: '100%', height: '180px' }}><canvas ref={canvasRef} role="img" aria-label="Line chart showing GPA trend over three semesters" /></div>;
};

const AttendanceChart = () => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && !chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: { labels: ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%'], datasets: [ { label: 'Students', data: [8, 14, 28, 70, 42, 38, 90, 240, 380, 290], backgroundColor: ['#FF3B30','#FF3B30','#FF3B30','#FF3B30','#FF9F0A','#FF9F0A','#FF9F0A','#30D158','#30D158','#30D158'], borderRadius: 3 } ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: {_callbacks_: { label: (ctx) => `${ctx.parsed.y} students` } } }, scales: { x: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 10 } }, grid: { color: CHART_CONFIG.gridColor } }, y: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } } } },
      });
    }
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, []);
  return <div style={{ position: 'relative', width: '100%', height: '130px' }}><canvas ref={canvasRef} role="img" aria-label="Bar chart showing attendance distribution" /></div>;
};

export default function MindGuardAnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState('Analytics');
  const [analytics, setAnalytics] = useState(null);
  const tabs = ['Students', 'Analytics', 'Assessment', 'Admin'];

  useEffect(() => {
    fetchAnalytics()
      .then((response) => {
        if (response.success && response.analytics) {
          setAnalytics(response.analytics);
        }
      })
      .catch(() => {
        setAnalytics(null);
      });
  }, []);

  const summary = analytics || FALLBACK_DATA.overview;
  const facultyData = analytics?.faculties || [
    { faculty: 'Applied Sci', high: 38, medium: 82, low: 230 },
    { faculty: 'Engineering', high: 42, medium: 94, low: 264 },
    { faculty: 'Commerce', high: 22, medium: 38, low: 182 },
    { faculty: 'Health Sci', high: 18, medium: 26, low: 164 },
  ];
  const departmentData = analytics?.departments || FALLBACK_DATA.departments;

  return (
    <div style={styles.app}>
      <div style={styles.topbar}>
        <div style={styles.logo}>X</div>
        <div style={styles.appname}>XAI Risk Sentinel<span>NUST · STUDENT MENTAL HEALTH</span></div>
        <div style={styles.navtabs}>{tabs.map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} style={{ ...styles.ntab, ...(activeTab === tab ? styles.ntabActive : {}) }}>{tab}</button>))}</div>
        <div style={styles.badgeCrit}><div style={styles.dot} />{analytics ? analytics.counts.high : 120} Critical</div>
        <div style={styles.user}><strong>Dr. Sibanda, N.</strong>Logged in</div>
      </div>
      <div style={styles.content}>
        <div><div style={styles.sectionLabel}>Overview — all students</div><div style={styles.statGrid}><StatCard label="Total students" value={summary.totalStudents ?? 1200} subtext={analytics ? `+${Math.round((summary.totalStudents - 1200) || 48)} this semester` : '+48 this semester'} subColor="up" /><StatCard label="High risk" value={analytics ? analytics.counts.high : 120} color="#FF6B6B" subtext={`${analytics ? analytics.counts.highPct : 10}% of cohort`} subColor="down" /><StatCard label="Medium risk" value={analytics ? analytics.counts.medium : 240} color="#FFB340" subtext={`${analytics ? analytics.counts.mediumPct : 20}% of cohort`} /><StatCard label="Avg attendance" value="71.4%" color="#34D963" subtext="+2.1% vs last sem" subColor="up" /></div></div>
        <div style={styles.chartsRow}><ChartCard title="Risk distribution by faculty"><div style={styles.legend}><div style={styles.legItem}><div style={{ ...styles.legSq, background: '#FF3B30' }} />High</div><div style={styles.legItem}><div style={{ ...styles.legSq, background: '#FF9F0A' }} />Medium</div><div style={styles.legItem}><div style={{ ...styles.legSq, background: '#30D158' }} />Low</div></div><FacultyChart faculties={facultyData} /></ChartCard><ChartCard title="GPA trend — semester over semester"><div style={styles.legend}><div style={styles.legItem}><div style={{ ...styles.legSq, background: '#636AFF' }} />Avg GPA</div><div style={styles.legItem}><div style={{ ...styles.legSq, background: '#FF3B30' }} />High-risk avg</div></div><GPAChart /></ChartCard></div>
        <div style={styles.bottomRow}><ChartCard title="High-risk rate by department"><DepartmentTable data={departmentData} /></ChartCard><ChartCard title="Recent activity"><ActivityLog activities={FALLBACK_DATA.recentActivity} /></ChartCard></div>
        <ChartCard title="Attendance distribution — all students" fullWidth><AttendanceChart /></ChartCard>
      </div>
    </div>
  );
}

const styles = {
  app: { background: '#0A0A12', color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px', minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topbar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: '#0D0D1A', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 },
  logo: { width: '28px', height: '28px', borderRadius: '7px', background: '#FF3B30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#fff' },
  appname: { fontSize: '13px', fontWeight: '500' },
  navtabs: { display: 'flex', gap: '2px', marginLeft: '24px' },
  ntab: { padding: '5px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', transition: '.12s', fontFamily: 'inherit' },
  ntabActive: { background: 'rgba(255,255,255,0.08)', color: '#fff' },
  badgeCrit: { padding: '4px 10px', borderRadius: '20px', fontSize: '11px', background: 'rgba(255,59,48,0.12)', border: '1px solid rgba(255,59,48,0.3)', color: '#FF6B6B', display: 'flex', alignItems: 'center', gap: '5px', marginLeft: 'auto' },
  dot: { width: '6px', height: '6px', borderRadius: '50%', background: '#FF3B30', animation: 'pulse 2s infinite' },
  user: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '12px' },
  content: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', overflowX: 'hidden' },
  sectionLabel: { fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.3)', marginBottom: '6px' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' },
  stat: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '10px 12px' },
  statLabel: { fontSize: '9px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: '4px' },
  statVal: { fontSize: '22px', fontWeight: '600' },
  statSub: { fontSize: '10px', marginTop: '2px' },
  chartsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' },
  chartCard: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '12px', minHeight: 'fit-content' },
  chartTitle: { fontSize: '10px', fontWeight: '600', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' },
  legend: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '8px', fontSize: '10px' },
  legItem: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.55)' },
  legSq: { width: '8px', height: '8px', borderRadius: '2px', flexShrink: 0 },
  bottomRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px' },
  deptRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '11px' },
  deptName: { fontSize: '11px', minWidth: '140px', flexShrink: 0, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  deptBarWrap: { flex: 1, height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '999px', overflow: 'hidden', minWidth: '40px' },
  deptBar: { height: '100%', borderRadius: '999px' },
  deptPct: { fontSize: '10px', width: '32px', textAlign: 'right', flexShrink: 0 },
  deptCount: { fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '24px', textAlign: 'right', flexShrink: 0 },
  activityItem: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '11px' },
  actDot: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, marginTop: '4px' },
  actText: { fontSize: '11px', color: 'rgba(255,255,255,0.7)', flex: 1, lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis' },
  actTime: { fontSize: '9px', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '4px' },
};
