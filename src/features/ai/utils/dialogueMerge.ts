// S-34: слияние переехало в core (нужно и перед выгрузкой, а core не
// импортирует features). Здесь — реэкспорт для useAIChat.ts.
export { stampMessage, withMessageIds } from '../../../core/storage/dialogueMerge';
