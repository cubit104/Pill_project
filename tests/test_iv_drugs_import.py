"""IV drugs importer: grouping products into drugs and picking the one label per drug."""

from services.iv_drugs_import import (
    build_row,
    containers_of,
    display_name,
    group_products,
    is_true_brand,
    label_tier,
    rank_labels,
    strength_of,
    suggest_exclusion,
)

TODAY = "20260920"


def product(**over):
    base = {
        "product_ndc": "0000-0001",
        "generic_name": "Vancomycin Hydrochloride",
        "brand_name": "Vancomycin Hydrochloride",
        "labeler": "Maker A",
        "ingredients": [{"name": "VANCOMYCIN HYDROCHLORIDE", "strength": "1 g/1"}],
        "dosage_form": "INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION",
        "route": ["INTRAVENOUS"],
        "marketing_category": "ANDA",
        "application_number": "ANDA062663",
        "listing_expiration_date": "20271231",
        "pharm_class": ["Glycopeptide Antibacterial [EPC]"],
        "dea_schedule": "",
        "packaging": ["10 VIAL in 1 CARTON / 20 mL in 1 VIAL"],
        "setids": ["setid-a"],
        "original_packager": True,
    }
    base.update(over)
    return base


RX = {
    "VANCOMYCIN HYDROCHLORIDE": [["11124", "vancomycin"]],
    "DEXTROSE MONOHYDRATE": [["4850", "glucose"]],
    "INFLIXIMAB": [["191831", "infliximab"]],
    "INFLIXIMAB-DYYB": [["191831", "infliximab"]],
    "PIPERACILLIN SODIUM": [["8339", "piperacillin"]],
    "TAZOBACTAM SODIUM": [["37617", "tazobactam"]],
}


def grouped(products):
    groups, skipped = group_products(products, RX)
    return groups, skipped


def test_premix_in_dextrose_is_the_same_drug():
    premix = product(
        ingredients=[
            {"name": "VANCOMYCIN HYDROCHLORIDE", "strength": "1 g/200mL"},
            {"name": "DEXTROSE MONOHYDRATE", "strength": "10 g/200mL"},
        ],
        setids=["setid-bag"],
    )
    groups, _ = grouped([product(), premix])
    assert list(groups) == ["11124"]
    assert len(groups["11124"]) == 2


def test_biosimilars_share_one_drug_and_combos_get_their_own():
    groups, _ = grouped(
        [
            product(ingredients=[{"name": "INFLIXIMAB", "strength": "100 mg/1"}], setids=["remicade"]),
            product(ingredients=[{"name": "INFLIXIMAB-DYYB", "strength": "100 mg/1"}], setids=["inflectra"]),
            product(
                ingredients=[
                    {"name": "PIPERACILLIN SODIUM", "strength": "4 g/1"},
                    {"name": "TAZOBACTAM SODIUM", "strength": ".5 g/1"},
                ],
                setids=["piptaz"],
            ),
        ]
    )
    assert sorted(groups) == ["191831", "8339+37617"]


def test_kits_and_products_without_a_label_are_skipped():
    groups, skipped = grouped([product(dosage_form="KIT"), product(setids=[])])
    assert not groups
    assert skipped == {"kit": 1, "no label id": 1}


def test_generic_name_in_the_brand_field_is_not_a_brand():
    assert not is_true_brand(product(), ["vancomycin"])
    assert not is_true_brand(product(brand_name="Vancomycin in Dextrose"), ["vancomycin"])
    assert is_true_brand(product(brand_name="Zosyn", generic_name="piperacillin and tazobactam"), ["piperacillin", "tazobactam"])


def test_nda_without_a_brand_name_ranks_with_generics():
    assert label_tier(product(marketing_category="NDA", brand_name="Remicade", generic_name="infliximab"), ["infliximab"]) == 0
    assert label_tier(product(marketing_category="NDA"), ["vancomycin"]) == 2
    assert label_tier(product(marketing_category="ANDA"), ["vancomycin"]) == 2
    assert label_tier(product(marketing_category="NDA AUTHORIZED GENERIC"), ["vancomycin"]) == 1
    assert label_tier(product(marketing_category="UNAPPROVED DRUG OTHER"), ["vancomycin"]) == 3


def test_containers_read_from_packaging():
    assert containers_of(product()) == {"vial"}
    assert containers_of(product(packaging=["24 BAG in 1 CARTON / 100 mL in 1 BAG"])) == {"bag"}
    assert containers_of(product(packaging=["10 AMPULE in 1 TRAY / 2 mL in 1 AMPULE"])) == {"ampule"}


def rank(products):
    groups, _ = grouped(products)
    (plist,) = groups.values()
    return [r["setid"] for r in rank_labels(plist, TODAY)]


def test_vial_label_beats_a_branded_premixed_bag():
    bag = product(
        brand_name="Tyzavan",
        marketing_category="NDA",
        dosage_form="INJECTION, SOLUTION",
        packaging=["100 mL in 1 BAG"],
        setids=["bag"],
    )
    assert rank([bag, product(setids=["vial"]), product(setids=["vial2"], labeler="Maker B")])[0] in ("vial", "vial2")


def test_repackager_expired_and_epidural_labels_go_last():
    good = product(setids=["good"])
    assert rank([product(setids=["repack"], original_packager=False), good])[0] == "good"
    assert rank([product(setids=["old"], listing_expiration_date="20200101"), good])[0] == "good"
    assert rank([product(setids=["spine"], route=["EPIDURAL", "INTRATHECAL", "INTRAVENOUS"]), good])[0] == "good"


def test_original_brand_beats_newer_brands_and_generics():
    def brand(name, app, setid):
        return product(
            ingredients=[{"name": "INFLIXIMAB", "strength": "100 mg/1"}],
            generic_name="infliximab",
            brand_name=name,
            marketing_category="BLA",
            application_number=app,
            setids=[setid],
        )

    assert rank([brand("Renflexis", "BLA761054", "renflexis"), brand("Remicade", "BLA103772", "remicade")])[0] == "remicade"


def test_label_with_more_strengths_wins_among_generics():
    one = product(setids=["one"], marketing_category="NDA", ingredients=[{"name": "VANCOMYCIN HYDROCHLORIDE", "strength": "2 g/1"}])
    two_a = product(setids=["two"])
    two_b = product(setids=["two"], ingredients=[{"name": "VANCOMYCIN HYDROCHLORIDE", "strength": "500 mg/1"}])
    assert rank([one, two_a, two_b])[0] == "two"


def test_exclusions():
    assert suggest_exclusion(["glucose"], []) == "plain IV fluid"
    assert suggest_exclusion(["alanine", "glycine"], []) == "parenteral nutrition component"
    assert suggest_exclusion(["potassium chloride", "sodium lactate", "calcium chloride"], []) == "fluid / electrolyte / nutrition mixture"
    assert suggest_exclusion(["gadobutrol"], ["Paramagnetic Contrast Agent [EPC]"]).startswith("imaging")
    assert suggest_exclusion(["potassium chloride"], []) == ""
    assert suggest_exclusion(["vancomycin"], ["Glycopeptide Antibacterial [EPC]"]) == ""


def test_us_label_name_wins_when_rxnorm_uses_another_word():
    plist = [dict(product(generic_name="glycopyrrolate"), _in_names=["glycopyrronium"])]
    assert display_name(plist) == "Glycopyrrolate"
    assert display_name([dict(product(), _in_names=["vancomycin"])]) == "Vancomycin"
    assert display_name([dict(product(), _in_names=["piperacillin", "tazobactam"])]) == "Piperacillin and Tazobactam"


def test_strength_drops_the_per_vial_suffix():
    assert strength_of(product()) == "1 g"
    assert strength_of(product(ingredients=[{"name": "X", "strength": "5 g/100mL"}])) == "5 g/100mL"


def test_build_row_newest_label_breaks_a_tie_and_a_label_in_use_is_kept():
    groups, _ = grouped([product(setids=["older"]), product(setids=["newer"], labeler="Maker B")])
    ((key, plist),) = groups.items()
    ranked = rank_labels(plist, TODAY)
    meta = {"older": {"version": 3, "date": "2024-01-01"}, "newer": {"version": 7, "date": "2026-05-01"}}

    row = build_row(key, plist, ranked, meta)
    assert (row["spl_set_id"], row["other_setids"], row["label_version"]) == ("newer", ["older"], 7)
    assert row["slug"] == "vancomycin" and row["rxcuis"] == ["11124"]
    assert row["label_presentation"] == "vial" and row["label_type"] == "generic"
    assert row["strengths"] == [{"strength": "1 g", "form": "Powder for solution", "makers": 2}]

    assert build_row(key, plist, ranked, meta, keep_setid="older")["spl_set_id"] == "older"
    assert build_row(key, plist, ranked, meta, keep_setid="no-longer-listed")["spl_set_id"] == "newer"


def test_names_are_cleaned_and_plain_us_names_beat_chemical_ones():
    def one(in_name, fda_name):
        return display_name([dict(product(generic_name=fda_name), _in_names=[in_name])])

    assert one("vasopressin (USP)", "vasopressin") == "Vasopressin"
    assert one("insulin aspart, human", "insulin aspart") == "Insulin Aspart"
    assert one("tetradecyl hydrogen sulfate (ester)", "sodium tetradecyl sulfate") == "Sodium Tetradecyl Sulfate"
    assert one("anti-thymocyte globulin (rabbit)", "anti-thymocyte globulin (rabbit)") == "Anti-thymocyte Globulin (Rabbit)"
    assert one("botulinum neurotoxin a/b immune globulin", "botulinum neurotoxin a/b immune globulin").endswith("A/B Immune Globulin")


def test_tracer_kits_and_blood_bank_solutions_are_excluded_by_product_name():
    assert suggest_exclusion(["betiatide"], [], ["Technescan MAG3 kit for the preparation of technetium Tc 99m mertiatide"]).startswith("imaging")
    assert suggest_exclusion(["iobenguane"], [], ["iobenguane I-123 AdreView"]).startswith("imaging")
    assert suggest_exclusion(["sodium citrate"], [], ["Anticoagulant Sodium Citrate Solution x"]) == "blood collection / apheresis solution"
    assert suggest_exclusion(["heparin"], [], ["heparin sodium Heparin Sodium in Dextrose"]) == ""
    assert suggest_exclusion(["insulin human"], [], ["insulin human Humulin R U-100"]) == ""


class RecordingConn:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params))


def existing_row(**over):
    base = {"slug": "vasopressin-usp", "spl_set_id": "set-1", "setid_locked": False, "card_status": "none", "untouched": True}
    base.update(over)
    return {"k1": base}


def import_row(**over):
    base = {
        "ingredient_key": "k1", "slug": "vasopressin", "decision": "include", "excluded_because": "", "spl_set_id": "set-1",
        "rxcuis": ["1"], "generic_name": "Vasopressin", "brand_names": [], "drug_class": [], "routes": [], "dea_schedule": None,
        "other_setids": [], "strengths": [], "product_count": 1, "maker_count": 1, "label_type": "generic", "label_brand": "",
        "label_maker": "", "label_presentation": "vial", "application_number": None, "label_version": 1, "label_date": None,
    }  # fmt: skip
    base.update(over)
    return base


def test_slug_is_corrected_only_before_launch_and_only_for_untouched_rows():
    from services.iv_drugs_import import upsert_rows

    conn = RecordingConn()
    stats = upsert_rows(conn, [import_row()], existing_row(), dry_run=False, fix_unpublished=True)
    assert stats["slug corrected (unpublished)"] == 1
    assert any("SET slug" in sql and params["slug"] == "vasopressin" for sql, params in conn.statements)

    for existing, fix in [(existing_row(), False), (existing_row(untouched=False), True)]:
        conn = RecordingConn()
        stats = upsert_rows(conn, [import_row()], existing, dry_run=False, fix_unpublished=fix)
        assert "slug corrected (unpublished)" not in stats
        assert not any("SET slug" in sql for sql, _ in conn.statements)


def test_now_excluded_row_is_soft_deleted_only_when_untouched():
    from services.iv_drugs_import import upsert_rows

    row = import_row(decision="exclude", excluded_because="imaging / contrast / radiopharmaceutical")
    conn = RecordingConn()
    stats = upsert_rows(conn, [row], existing_row(), dry_run=False, fix_unpublished=True)
    assert stats["removed (unpublished, now excluded)"] == 1
    assert len(conn.statements) == 1 and "deleted_at = now()" in conn.statements[0][0]

    conn = RecordingConn()
    stats = upsert_rows(conn, [row], existing_row(untouched=False), dry_run=False, fix_unpublished=True)
    assert stats["refreshed"] == 1 and not any("deleted_at" in sql for sql, _ in conn.statements)


def test_two_rxnorm_ingredients_with_one_us_name_become_one_drug():
    from services.iv_drugs_import import merge_same_name

    rx = {"TETRADECYL HYDROGEN SULFATE (ESTER)": [["1370424", "tetradecyl hydrogen sulfate (ester)"]], "SODIUM TETRADECYL SULFATE": [["9913", "sodium tetradecyl sulfate"]]}
    brand = product(generic_name="tetradecyl hydrogen sulfate (ester)", brand_name="Sotradecol", ingredients=[{"name": "TETRADECYL HYDROGEN SULFATE (ESTER)", "strength": "10 mg/mL"}], setids=["a"])
    generic = product(generic_name="Sodium Tetradecyl Sulfate", ingredients=[{"name": "SODIUM TETRADECYL SULFATE", "strength": "10 mg/mL"}], setids=["b"])
    # as in FDA's data: one maker lists the ester as the ingredient but still calls the product by its plain name
    plain_named = dict(brand, generic_name="Sodium Tetradecyl Sulfate", brand_name="Sodium Tetradecyl Sulfate", setids=["a2"])
    groups, _ = group_products([brand, plain_named, generic, dict(generic, setids=["b2"]), dict(generic, setids=["b3"])], rx)
    assert sorted(groups) == ["1370424", "9913"]

    merged = merge_same_name(groups)
    assert list(merged) == ["9913"] and len(merged["9913"]) == 5
    assert display_name(merged["9913"]) == "Sodium Tetradecyl Sulfate"


def test_prelaunch_fix_removes_a_row_the_importer_no_longer_produces_and_frees_its_slug():
    from services.iv_drugs_import import upsert_rows

    existing = {
        "k1": {"slug": "drug-2", "spl_set_id": "set-1", "setid_locked": False, "card_status": "none", "untouched": True},
        "gone": {"slug": "drug", "spl_set_id": "set-9", "setid_locked": False, "card_status": "none", "untouched": True},
    }
    conn = RecordingConn()
    stats = upsert_rows(conn, [import_row(slug="drug")], existing, dry_run=False, fix_unpublished=True)
    assert stats["removed (unpublished, no longer produced)"] == 1 and stats["slug corrected (unpublished)"] == 1
    removed = [sql for sql, params in conn.statements if params == {"k": "gone"}]
    assert len(removed) == 1 and "deleted_at = now()" in removed[0] and "-removed-" in removed[0]
    assert any("SET slug" in sql and params.get("slug") == "drug" for sql, params in conn.statements if params.get("k") == "k1")


def test_strengths_table_is_in_dose_order_with_plain_form_names_and_no_bulk_powder():
    from services.iv_drugs_import import strengths_table

    def vial(strength, form="INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION", labeler="Maker A"):
        return product(ingredients=[{"name": "VANCOMYCIN HYDROCHLORIDE", "strength": strength}], dosage_form=form, labeler=labeler)

    table = strengths_table(
        [
            vial("10 g/1"),
            vial("1 g/1"),
            vial("1 g/1", form="INJECTION, POWDER, FOR SOLUTION", labeler="Maker B"),
            vial("500 mg/1"),
            vial("1 g/200mL", form="INJECTION, SOLUTION"),
            vial("1025 mg/mg", form="INJECTION, POWDER, FOR SOLUTION"),
            vial("5000 [USP'U]/mL", form="INJECTION, SOLUTION"),
        ]
    )
    assert [(r["strength"], r["form"], r["makers"]) for r in table] == [
        ("500 mg", "Powder for solution", 1),
        ("1 g", "Powder for solution", 2),
        ("1 g/200mL", "Solution", 1),
        ("10 g", "Powder for solution", 1),
        ("5000 [USP'U]/mL", "Solution", 1),
    ]


def test_the_injection_run_lists_every_needle_route_and_only_counts_real_injection_forms():
    from services.iv_drugs_import import INJECTION_SEARCH, IV_SEARCH, is_injectable_form

    assert 'route:"INTRAMUSCULAR"' in INJECTION_SEARCH and 'route:"SUBCUTANEOUS"' in INJECTION_SEARCH and 'route:"INTRAVENOUS"' in INJECTION_SEARCH
    assert INJECTION_SEARCH.endswith('AND finished:true AND product_type:"HUMAN PRESCRIPTION DRUG"') and IV_SEARCH.startswith('route:"INTRAVENOUS"')
    for form in ("INJECTION, SOLUTION", "INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION", "SOLUTION", "LIQUID", "INJECTABLE, LIPOSOMAL"):
        assert is_injectable_form(form)
    # FDA files these under a needle route too: eye drops, implants, a gas, a tablet, talc
    for form in ("SOLUTION/ DROPS", "IMPLANT", "GAS", "TABLET, FILM COATED", "POWDER", "CONCENTRATE", ""):
        assert not is_injectable_form(form)
