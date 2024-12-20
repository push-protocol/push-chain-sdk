import React, { useState } from 'react';
import { CaretDown } from 'shared-components';
import { Text } from 'shared-components';

interface DropdownItem {
  label: string;
  icon: React.ReactNode;
  value: string;
}

interface SelectProps {
  value: string;
  onSelect: (value: string) => void;
  options: DropdownItem[];
}

const Select: React.FC<SelectProps> = ({ value, onSelect, options }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const handleSelect = (item: string) => {
    onSelect(item);
    setIsOpen(false);
  };

  return (
    <div className="relative w-[20%]">
      <button
        className={`w-full flex items-center justify-between p-3 gap-2 border-[1.5px] rounded-xl ${
          isOpen ? 'border-[#F3AEFF]' : 'border-[#EAEBF2]'
        } focus:border-[#F3AEFF] hover:border-[#C4CBD5]`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>{options.find((i) => i.value === value)?.icon}</span>
        <CaretDown />
      </button>

      {isOpen && (
        <ul className="absolute flex flex-col w-40 z-10 p-2 gap-2 bg-white border border-[#C4CBD5] rounded-xl shadow-lg mt-3 right-0">
          {options.map((item) => (
            <li
              key={item.label}
              onClick={() => handleSelect(item.value)}
              className="flex items-center px-1 py-2 rounded-[6px] hover:bg-gray-100 cursor-pointer"
            >
              <span className="mr-2">{item.icon}</span>
              <Text variant="bs-regular">{item.label}</Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Select;
