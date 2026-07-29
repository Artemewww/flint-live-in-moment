import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Star, Send, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';

interface FeedbackModalProps {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  onSubmit: (data: FeedbackData) => void;
}

export interface FeedbackData {
  eventId: string;
  rating: number;
  wouldReturn: boolean;
  feedback: string;
  submittedAt: string;
}

export default function FeedbackModal({ eventId, eventTitle, onClose, onSubmit }: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [wouldReturn, setWouldReturn] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0 || wouldReturn === null) return;
    
    setIsSubmitting(true);
    
    const feedbackData: FeedbackData = {
      eventId,
      rating,
      wouldReturn,
      feedback: feedback.trim(),
      submittedAt: new Date().toISOString()
    };
    
    // Имитация отправки (в будущем можно сохранять в localStorage или отправлять на сервер)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    onSubmit(feedbackData);
    setIsSubmitting(false);
  };

  return (
    <AnimatePresence>
      {eventId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="feedback-modal-root">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
          />

          {/* Feedback Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="bg-[#121212] md:rounded-3xl w-full max-w-lg shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Scrollable Content */}
            <div className="overflow-y-auto w-full flex-grow scrollbar-none p-4 sm:p-6 space-y-6">
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-brand" />
                  <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                    Обратная связь
                  </span>
                </div>
                <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
                  Как вам мероприятие?
                </h2>
                <p className="text-white/60 text-xs font-sans">
                  Ваше мнение помогает нам делать встречи лучше
                </p>
              </div>

              {/* Rating */}
              <div className="space-y-3">
                <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                  Оцените опыт (1-5)
                </label>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className={`p-2 rounded-xl transition-all outline-none cursor-pointer border-none ${
                        star <= rating
                          ? 'bg-brand/20 text-brand scale-110'
                          : 'bg-white/5 text-white/30 hover:bg-white/10'
                      }`}
                    >
                      <Star className={`w-6 h-6 ${star <= rating ? 'fill-brand' : ''}`} />
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <p className="text-center text-xs text-white/50 font-mono">
                    {rating === 1 && '😞 Очень плохо'}
                    {rating === 2 && '😕 Плохо'}
                    {rating === 3 && '😐 Нормально'}
                    {rating === 4 && '😊 Хорошо'}
                    {rating === 5 && '🤩 Отлично!'}
                  </p>
                )}
              </div>

              {/* Would Return */}
              <div className="space-y-3">
                <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                  Хотите повторить?
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWouldReturn(true)}
                    className={`flex-1 py-3 rounded-xl border transition-all outline-none cursor-pointer flex items-center justify-center gap-2 ${
                      wouldReturn === true
                        ? 'bg-brand/20 border-brand/40 text-brand'
                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    <ThumbsUp className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Да, точно</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWouldReturn(false)}
                    className={`flex-1 py-3 rounded-xl border transition-all outline-none cursor-pointer flex items-center justify-center gap-2 ${
                      wouldReturn === false
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    <ThumbsDown className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Пока нет</span>
                  </button>
                </div>
              </div>

              {/* Feedback */}
              <div className="space-y-3">
                <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                  Что понравилось / что улучшить? (необязательно)
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Поделитесь впечатлениями..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-sans placeholder:text-white/30 focus:outline-none focus:border-brand/40 resize-none"
                  rows={4}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 border-t border-white/10 bg-[#161616]">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={rating === 0 || wouldReturn === null || isSubmitting}
                className={`w-full py-4 rounded-xl font-black font-mono text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all outline-none border-none cursor-pointer ${
                  rating === 0 || wouldReturn === null || isSubmitting
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10 active:scale-98'
                }`}
              >
                {isSubmitting ? (
                  'Отправляем...'
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Отправить отзыв
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}