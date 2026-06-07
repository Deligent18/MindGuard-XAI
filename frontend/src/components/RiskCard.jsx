import React from 'react';
import { getRiskLevel } from '../api';

const RiskCard = ({ student, onViewExplanation }) => {
  const riskPercent = student.risk_percent ?? (student.risk * 100) ?? 0;
  const riskInfo = getRiskLevel(riskPercent);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-600 transition-all duration-300">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-semibold text-lg text-white">{student.name}</h3>
          <p className="text-gray-400 text-sm">{student.programme || student.department}</p>
        </div>
        <div className={`px-4 py-1.5 text-xs font-bold rounded-full ${riskInfo.bgColor}`} style={{ color: riskInfo.color }}>
          {riskInfo.label}
        </div>
      </div>

      <div className="flex justify-center my-8">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#374151" strokeWidth="14"/>
            <circle cx="60" cy="60" r="52" fill="none" stroke={riskInfo.color} strokeWidth="14"
              strokeDasharray={`${(riskPercent / 100) * 327} 327`} strokeLinecap="round"/>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-5xl font-bold text-white">{riskPercent.toFixed(1)}</div>
            <div className="text-sm text-gray-400 -mt-1">RISK</div>
          </div>
        </div>
      </div>

      <button
        onClick={() => onViewExplanation(student)}
        className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm font-medium transition"
      >
        View Simple Explanation →
      </button>
    </div>
  );
};

export default RiskCard;
