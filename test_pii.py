"""Обезличивание ПДн перед отправкой в DeepSeek и обратная подстановка в ответе."""
import pii


def test_masks_typical_document_pii_and_restores():
    text = ("Ответственный — Иванов Иван Иванович, тел. +7 (912) 345-67-89, ivanov@corp.ru. "
            "Согласовано: Петрова А.С. Реквизиты ООО «Ромашка»: ИНН 7701234567, КПП 770101001, "
            "р/с 40702810900000012345. СНИЛС 123-456-789 01. Паспорт серия 45 12 № 123456.")
    m = pii.Masker()
    masked = m.mask(text)
    for secret in ("Иванов", "912", "ivanov@", "Петрова", "Ромашка", "7701234567",
                   "770101001", "40702810900000012345", "123-456-789", "123456."):
        assert secret not in masked, (secret, masked)
    assert "[ФИО_1]" in masked and "[ТЕЛ_1]" in masked and "[ОРГ_1]" in masked
    assert m.unmask(masked) == text


def test_same_value_same_token_and_model_answer_restored():
    m = pii.Masker()
    masked = m.mask("Звонить Сидоров Пётр Петрович. Сидоров Пётр Петрович на месте с 9:00.")
    assert masked.count("[ФИО_1]") == 2
    assert m.unmask("Обратитесь к [ФИО_1].") == "Обратитесь к Сидоров Пётр Петрович."


def test_ordinary_text_untouched():
    text = ("Приложение А. Правила внутреннего трудового распорядка. Пожарная безопасность: "
            "раздел 3.2, приказ № 15 от 01.02.2026, смена 8 часов, Главный инженер.")
    assert pii.Masker().mask(text) == text
