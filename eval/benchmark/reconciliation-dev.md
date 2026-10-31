# Reconciliation log - dev set

Step 2 of the labelling process (see GUIDELINES.md): after the blind pass the
detector was run once and every disagreement was re-checked against the paper.
Only the changes below were made. Nothing was changed to flatter the detector:
the 35 remaining false positives are left standing, and all but two of them
come from one paper whose author block the detector misreads (see the bottom
of this file).

Entries added here carry `"recon": true`, so glossary recall can be reported
with and without them.

## Definitions the blind pass missed

The blind pass read a truncated candidate list for a few papers, so real
definitions further down the list were not labelled. Each was re-checked in
the text before being added.

- 10.64898/2025.12.01.691077: defined += CST = Cell Signaling Technology  (antibody-table footnote key: "CST = Cell Signaling Technology (Danvers, MA, USA)")
- 10.64898/2025.12.01.691077: defined += TFS = Thermo Fisher Scientific  (same footnote key)
- 10.1126/sciadv.abf4459: defined += THF = tetrahydrofolate
- 10.1126/sciadv.abf4459: defined += TGEV = transmissible gastroenteritis coronavirus
- 10.1126/sciadv.abf4459: defined += gRNA = genomic RNA
- 10.1126/sciadv.abf4459: defined += sgmRNA = subgenomic mRNA  (written out as "subgenomic N protein mRNA synthesis" before the short form is used)
- 10.1126/sciadv.abf4459: defined += NEB = New England Biolabs
- 10.1126/sciadv.abf4459: defined += PCR = polymerase chain reaction
- 10.1126/sciadv.abf4459: defined += PAGE = polyacrylamide gel electrophoresis
- 10.1126/sciadv.abf4459: defined += TBE = tris-borate EDTA
- 10.1126/sciadv.abf4459: defined += rRNA = ribosomal RNA  ("16S ribosomal RNA (rRNA; Fig. 9F)")
- 10.7554/eLife.81856: defined += FBS = fetal bovine serum
- 10.1038/s44318-025-00615-w: defined += Ub = ubiquitin
- 10.1038/s41563-021-01020-4: defined += Ab = antibody
- 10.1038/s41598-026-40706-0: defined += Gluc = Gaussia luciferase
- 10.1038/s41598-026-40706-0: defined += SEAP = secreted Alkaline Phosphatase
- 10.1038/s41598-026-40706-0: defined += dPCR = digital PCR
- 10.1016/j.jbc.2024.107846: defined += LoKI = Local kinase inhibitors

## Standard abbreviations the papers never spell out

Used at least twice standalone, standard in the field, never defined.

- 10.64898/2025.12.01.691077: ANOVA, BSA, EMT, PBS, WB, cDNA, lncRNA
- 10.7554/eLife.81856: EGFP, HEPES, RPMI
- 10.1016/j.celrep.2024.114803: NADH, SDS-PAGE, rRNA
- 10.1038/s41467-021-24194-6: LC-MS, MS
- 10.1093/nar/gkae282: HEPES
- 10.1126/sciadv.abf4459: EDTA, mRNA
- 10.1073/pnas.1301676110: SD
- 10.3390/foods9111678: MS
- 10.1038/s41598-026-40706-0: DMEM, PCR, cDNA
- 10.7554/eLife.83853: ANOVA, BSA, HEPES, ncRNA, rRNA, tRNA
- 10.1038/s41565-023-01321-6: TEM

## Ignore categories the blind pass missed

- 10.64898/2025.12.01.691077: DAP, TTFields  (appear only in the reference list)
- 10.1016/j.celrep.2024.114803: SEC  (not an abbreviation: "SECOND STAGE" split by the figure's text extraction)
- 10.1371/journal.pgen.1010901: ADL, EBC  (used once only)
- 10.1038/s41598-026-40706-0: IP  (only ever inside the product name "miRNA Target IP kit")
- 10.1038/s41598-026-40706-0: UMIs, DEJ  (used once only)
- 10.7554/eLife.83853: MAPK, ROI, siRNA  (used once only)
- 10.7554/eLife.81856: tRNA  (used once only)
- 10.1126/sciadv.abf4459: EMS  (used once only)
- 10.1101/2023.12.01.569403: ATP  (used once only)
- 10.3390/biom14020176: ChIP  (used once only)

## Left standing: a detector defect, not a labelling gap

33 of the 35 remaining false positives come from 10.64898/2025.12.01.691077, whose text begins
with a semicolon-separated author and affiliation block ("Authors: … ;
Affiliations: 1University of Ljubljana; Faculty of Medicine; …"). The detector
reads those semicolons as an abbreviation list and returns author names and
institutions as abbreviations ("Alja", "Sergej", "Faculty", "Slovenia"), along
with fragments of numbered citations ("28).", "44).", "24]”"). The same paper
also produces one runaway long form for PDK1 that swallows the whole author
block. These are defects to fix in the list and glossary phases, so they stay
counted against precision.

The other two are PD and a single-use abbreviation, both correctly outside the
labels.

## Scoring note

Nothing in the scorer was changed for the dev set beyond allowing a label to
name the Zotero item key its text was exported under, so a preprint with no
DOI and no arXiv ID in the library is matched to its text instead of being
skipped.
