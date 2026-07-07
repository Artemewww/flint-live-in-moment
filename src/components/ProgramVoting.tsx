import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Clock, Vote } from 'lucide-react';
import { CommunityEvent } from '../types';

interface ProgramVotingProps {
  event: CommunityEvent;
  onVote: (eventId: string, option: string) => void;
}

export default function ProgramVoting({ event, onVote }: ProgramVotingProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  if (!event.programVoting || !event.programVoting.enabled) {
    return null;
  }

  const { deadline, options } = event.programVoting;
  const today = new Date().toISOString().split('T')[0];
  const isExpired = deadline < today;

  const handleVote = (option: string) => {
    if (hasVoted || isExpired) return;
    setSelectedOption(option);
    setHasVoted(true);
    onVote(event.id, option);
  };

  const daysLeft = Math.ceil((new Date(deadline).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote className="w-5 h-5 text-brand" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Голосование за программу</h3>
        </div>
        {!isExpired && (
          <div className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider ${
            daysLeft <= 2 ? 'text-rose-400' : 'text-white/60'
          }`}>
            <Clock className="w-3.5 h-3.5" />
            {daysLeft > 0 ? `${daysLeft} дн. осталось` : 'Завтра дедлайн'}
          </div>
        )}
      </div>

      <p className="text-xs text-white/70 leading-relaxed">
        Выберите предпочтительный вариант программы мероприятия. Голосование завершается {deadline}.
      </p>

      <div className="space-y-2">
        {options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => handleVote(option)}
            disabled={hasVoted || isExpired}
            className={`
              w-full text-left p-4 rounded-xl border transition-all cursor-pointer
              ${hasVoted || isExpired
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:border-brand/40 hover:bg-white/5'
              }
              ${selectedOption === option
                ? 'bg-brand/10 border-brand/40'
                : 'bg-white/5 border-white/10'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5
                ${selectedOption === option
                  ? 'border-brand bg-brand'
                  : 'border-white/30'
                }
              `}>
                {selectedOption === option && (
                  <Check className="w-3 h-3 text-black" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm text-white/90 font-medium">{option}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {hasVoted && (
        <div className="bg-brand/10 border border-brand/30 rounded-xl p-3 flex items-center gap-2">
          <Check className="w-4 h-4 text-brand shrink-0" />
          <span className="text-xs text-brand font-medium">Ваш голос учтён!</span>
        </div>
      )}

      {isExpired && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <span className="text-xs text-white/50">Голосование завершено</span>
        </div>
      )}
    </div>
  );
}