import React, { useState } from 'react';

interface RecipientInputProps {
  value: string[];
  onChange: (recipients: string[]) => void;
}

const RecipientInput: React.FC<RecipientInputProps> = ({ value, onChange }) => {
  const [inputValue, setInputValue] = useState<string>('');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && inputValue.trim()) {
      const updatedRecipients = [...value, inputValue.trim()];
      onChange(updatedRecipients); // Pass updated recipients to the parent
      setInputValue(''); // Clear input field
    }
  };

  const removeRecipient = (index: number) => {
    const updatedRecipients = value.filter((_, i) => i !== index);
    onChange(updatedRecipients); // Pass updated recipients to the parent
  };

  return (
    <div className="border border-gray-300 rounded-md flex items-center px-3 py-2">
      <label className="mr-2 text-gray-500">To</label>
      <div className="flex flex-wrap gap-2 items-center">
        {value.map((recipient, index) => (
          <div
            key={index}
            className="flex items-center bg-gray-100 border border-gray-300 rounded-full px-3 py-1"
          >
            <span className="text-sm text-gray-800">{recipient}</span>
            <button
              onClick={() => removeRecipient(index)}
              className="ml-2 text-gray-500 hover:text-gray-700 focus:outline-none"
            >
              ×
            </button>
          </div>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-grow outline-none text-sm px-1"
          placeholder="Add recipients"
        />
      </div>
    </div>
  );
};

export default RecipientInput;
