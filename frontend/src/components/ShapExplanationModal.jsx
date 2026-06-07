import React from 'react';

const ShapExplanationModal = ({ student, onClose }) => {
  const riskPercent = student.risk_percent ?? (student.risk * 100) ?? 0;
  const tier = student.tier || (riskPercent >= 75 ? 'high' : riskPercent >= 50 ? 'medium' : 'low');

  const generateSimpleExplanation = () => {
    let text = `This student currently has a ${riskPercent.toFixed(1)}% risk of mental health challenges. `;

    if (tier === 'high') text += "This is a high risk level that needs immediate attention. ";
    else if (tier === 'medium') text += "This is a medium risk level that should be monitored closely. ";
    else text += "This is currently a low risk level. ";

    text += "The main contributing factors include academic performance, sleep patterns, and attendance. ";
    text += "We strongly recommend scheduling a counselling session to provide early support and prevent the risk from increasing.";

    return text;
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-3xl max-w-lg w-full p-8">
        <h2 className="text-2xl font-bold mb-2">Understanding {student.name}'s Risk</h2>
        <p className="text-gray-400 mb-6">Simple & Clear Explanation</p>

        <div className="bg-gray-800 rounded-2xl p-6 mb-6 leading-relaxed text-gray-200">
          {generateSimpleExplanation()}
        </div>

        <button
          onClick={onClose}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default ShapExplanationModal;
