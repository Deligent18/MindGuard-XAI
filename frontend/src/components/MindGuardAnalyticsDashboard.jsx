import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { fetchAnalytics } from '../api';
import './analyticsDashboard.css';


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

// Using provided HTML/CSS classes from analyticsDashboard.css
const StatCard = ({ label, value, subtext, color = 'inherit', subColor = 'default' }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-val" style={color !== 'inherit' ? { color } : undefined}>
      {value}
    </div>
    <div
      className={`stat-sub ${subColor === 'up' ? 'up' : subColor === 'down' ? 'dn' : ''}`}
      style={subColor === 'default' ? { color: 'rgba(255,255,255,0.3)' } : undefined}
    >
      {subtext}
    </div>
  </div>
);

const ChartCard = ({ title, children }) => (
  <div className="chart-card">
    <div className="chart-title">{title}</div>
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
          <div key={dept.name} className="dept-row">
            <div className="dept-name">{dept.name}</div>
            <div className="dept-bar-wrap">
              <div style={{ width: `${pct * 3}%`, background: color }} className="dept-bar" />
            </div>
            <div className="dept-pct" style={{ color }}>{pct}%</div>
            <div className="dept-count">{dept.high}</div>
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
        <div key={activity.id} className="activity-item">
          <div
            className="act-dot"
            style={{ background: dotColorMap[activity.type] || '#636AFF' }}
          />
          <div className="act-text">{activity.text}</div>
          <div className="act-time">{activity.time}</div>
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
  return (
    <div style={{ position: 'relative', width: '100%', height: '180px' }}>
      <canvas ref={canvasRef} role="img" aria-label="Stacked bar chart of risk distribution across faculties" />
    </div>
  );
};


const GPAChart = () => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && !chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: 'line',
        data: { labels: ['Sem 1', 'Sem 2', 'Sem 3'], datasets: [ { label: 'Avg GPA', data: [3.1, 2.95, 2.8], borderColor: '#636AFF', backgroundColor: 'rgba(99,106,255,0.08)', tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: '#636AFF', borderDash: [] }, { label: 'High-risk avg', data: [2.4, 1.9, 1.6], borderColor: '#FF3B30', backgroundColor: 'rgba(255,59,48,0.06)', tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: '#FF3B30', borderDash: [4, 3] } ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } }, y: { min: 1, max: 4, ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 }, stepSize: 0.5 }, grid: { color: CHART_CONFIG.gridColor } } } },
      });
    }
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, []);
  return (
    <div style={{ position: 'relative', width: '100%', height: '180px' }}>
      <canvas ref={canvasRef} role="img" aria-label="Line chart showing GPA trend over three semesters" />
    </div>
  );
};


const AttendanceChart = () => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && !chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: { labels: ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%'], datasets: [ { label: 'Students', data: [8, 14, 28, 70, 42, 38, 90, 240, 380, 290], backgroundColor: ['#FF3B30','#FF3B30','#FF3B30','#FF3B30','#FF9F0A','#FF9F0A','#FF9F0A','#30D158','#30D158','#30D158'], borderRadius: 3 } ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} students` } } }, scales: { x: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 10 } }, grid: { color: CHART_CONFIG.gridColor } }, y: { ticks: { color: CHART_CONFIG.tickColor, font: { size: 11 } }, grid: { color: CHART_CONFIG.gridColor } } } },
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
  const criticalCount = analytics ? analytics.counts.high : 120;

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">X</div>
        <div className="appname">
          XAI Risk Sentinel
          <span>NUST · STUDENT MENTAL HEALTH</span>
        </div>

        <div className="navtabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`ntab ${activeTab === tab ? 'active' : ''}`}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="badge-crit" style={{ marginLeft: 'auto' }}>
          <div className="dot" />
          {criticalCount} Critical
        </div>

        <div className="user" style={{ marginLeft: 12 }}>
          <strong>Dr. Sibanda, N.</strong>
          Logged in
        </div>
      </div>

      <div className="content">
        <div>
          <div className="section-label">Overview — all students</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Total students</div>
              <div className="stat-val">{summary.totalStudents ?? 1200}</div>
              <div className="stat-sub up">
                {analytics
                  ? `+${Math.round((summary.totalStudents - 1200) || 48)} this semester`
                  : '+48 this semester'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">High risk</div>
              <div className="stat-val" style={{ color: '#FF6B6B' }}>
                {analytics ? analytics.counts.high : 120}
              </div>
              <div className="stat-sub dn">{analytics ? analytics.counts.highPct : 10}% of cohort</div>
            </div>
            <div className="stat">
              <div className="stat-label">Medium risk</div>
              <div className="stat-val" style={{ color: '#FFB340' }}>
                {analytics ? analytics.counts.medium : 240}
              </div>
              <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {analytics ? analytics.counts.mediumPct : 20}% of cohort
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Avg attendance</div>
              <div className="stat-val" style={{ color: '#34D963' }}>
                71.4%
              </div>
              <div className="stat-sub up">+2.1% vs last sem</div>
            </div>
          </div>
        </div>

        <div className="charts-row">
          <div className="chart-card">
            <div className="chart-title">Risk distribution by faculty</div>
            <div className="legend">
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF3B30' }} />
                High
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF9F0A' }} />
                Medium
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#30D158' }} />
                Low
              </div>
            </div>
            <div style={{ position: 'relative', width: '100%', height: '180px' }}>
              <FacultyChart faculties={facultyData} />
            </div>
          </div>
          <div className="chart-card">
            <div className="chart-title">GPA trend — semester over semester</div>
            <div className="legend">
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#636AFF' }} />
                Avg GPA
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF3B30' }} />
                High-risk avg
              </div>
            </div>
            <div style={{ position: 'relative', width: '100%', height: '180px' }}>
              <GPAChart />
            </div>
          </div>
        </div>

        <div className="bottom-row">
          <div className="table-card">
            <div className="chart-title">High-risk rate by department</div>
            <DepartmentTable data={departmentData} />
          </div>
          <div className="trend-card">
            <div className="chart-title">Recent activity</div>
            <ActivityLog activities={FALLBACK_DATA.recentActivity} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Attendance distribution — all students</div>
          <div style={{ position: 'relative', width: '100%', height: '130px' }}>
            <AttendanceChart />
          </div>
        </div>
      </div>
    </div>
  );
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
    <div className="app">
      <div className="topbar">
        <div className="logo">X</div>
        <div className="appname">
          XAI Risk Sentinel
          <span>NUST · STUDENT MENTAL HEALTH</span>
        </div>

        <div className="navtabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`ntab ${activeTab === tab ? 'active' : ''}`}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="badge-crit">
          <div className="dot" />
          {analytics ? analytics.counts.high : 120} Critical
        </div>

        <div className="user" style={{ marginLeft: 12 }}>
          <strong>Dr. Sibanda, N.</strong>Logged in
        </div>
      </div>

      <div className="content">
        <div>
          <div className="section-label">Overview — all students</div>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Total students</div>
              <div className="stat-val">{summary.totalStudents ?? 1200}</div>
              <div className="stat-sub up">
                {analytics
                  ? `+${Math.round((summary.totalStudents - 1200) || 48)} this semester`
                  : '+48 this semester'}
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">High risk</div>
              <div className="stat-val" style={{ color: '#FF6B6B' }}>
                {analytics ? analytics.counts.high : 120}
              </div>
              <div className="stat-sub dn">{analytics ? analytics.counts.highPct : 10}% of cohort</div>
            </div>

            <div className="stat">
              <div className="stat-label">Medium risk</div>
              <div className="stat-val" style={{ color: '#FFB340' }}>
                {analytics ? analytics.counts.medium : 240}
              </div>
              <div className="stat-sub" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {analytics ? analytics.counts.mediumPct : 20}% of cohort
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">Avg attendance</div>
              <div className="stat-val" style={{ color: '#34D963' }}>
                71.4%
              </div>
              <div className="stat-sub up">+2.1% vs last sem</div>
            </div>
          </div>
        </div>

        <div className="charts-row">
          <div className="chart-card">
            <div className="chart-title">Risk distribution by faculty</div>
            <div className="legend">
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF3B30' }} />High
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF9F0A' }} />Medium
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#30D158' }} />Low
              </div>
            </div>
            <FacultyChart faculties={facultyData} />
          </div>

          <div className="chart-card">
            <div className="chart-title">GPA trend — semester over semester</div>
            <div className="legend">
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#636AFF' }} />Avg GPA
              </div>
              <div className="leg-item">
                <div className="leg-sq" style={{ background: '#FF3B30' }} />High-risk avg
              </div>
            </div>
            <GPAChart />
          </div>
        </div>

        <div className="bottom-row">
          <div className="table-card">
            <div className="chart-title">High-risk rate by department</div>
            <DepartmentTable data={departmentData} />
          </div>

          <div className="trend-card">
            <div className="chart-title">Recent activity</div>
            <ActivityLog activities={FALLBACK_DATA.recentActivity} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Attendance distribution — all students</div>
          <AttendanceChart />
        </div>
      </div>
    </div>
  );
}


