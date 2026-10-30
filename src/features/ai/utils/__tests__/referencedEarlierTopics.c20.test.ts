// Случай #20 (20.1): ссылка в заметке на прошлые записи — тема поиска.
import { describe, it, expect } from 'vitest';
import { referencedEarlierTopics } from '../aiChatTransport';

describe('referencedEarlierTopics', () => {
  it.each([
    ['В одной из ранних заметок про отца я уже это разбирал.', ['отца']],
    ['Как в прошлых записях о работе с Ниной.', ['работе с Ниной']],
    ['Я раньше писал про бессонницу и там было иначе.', ['бессонницу']],
    ['В старых заметках об отпуске, где мы ездили к морю.', ['отпуске']],
  ])('%s', (text, expected) => {
    expect(referencedEarlierTopics(text)).toEqual(expected);
  });

  it('без ссылки на прошлые записи — пусто', () => {
    expect(referencedEarlierTopics('Сегодня писал про бессонницу в заметке.')).toEqual([]);
    expect(referencedEarlierTopics('Пробежал шесть километров.')).toEqual([]);
  });

  it('повтор темы — один раз', () => {
    expect(referencedEarlierTopics('В ранних заметках про маму. И в прошлых записях про маму.')).toEqual(['маму']);
  });
});
